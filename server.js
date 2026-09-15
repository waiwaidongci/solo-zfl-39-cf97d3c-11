import http from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { page } from "./page.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, "data", "paper-pulp-fermentation.json");
const port = Number(process.env.PORT || 3039);

// ---------- 业务规则常量（页面通过 /api/config 获取，接口与页面一致） ----------
const SHIFTS = ["早班", "中班", "晚班"];
const CLEAN_RULES = {
  temperature: { label: "温度", unit: "℃", min: 60, max: 100 },
  concentration: { label: "浓度", unit: "%", min: 0.5, max: 5 },
  durationMinutes: { label: "时长", unit: "分钟", min: 20, max: 120 },
};
const DEFAULT_VALID_HOURS = 72;
const MAX_VALID_HOURS = 24 * 7;
const EXPIRING_SOON_HOURS = 24;
const VAT_STATUS = {
  dirty: "待清洗",
  cleaning: "清洗中",
  recheck: "复检中",
  pending_release: "待放行",
  released: "已放行",
  expired: "已失效",
  pending_recheck: "待补检",
  quarantined: "已隔离",
};
const ORDER_STATUS = {
  dispatched: "已派单",
  claimed: "已领单",
  recheck: "待复检",
  rechecked: "待放行",
  released: "已放行",
  rejected: "已拒绝",
  expired: "已失效",
};
const DISPATCHABLE = ["dirty", "expired", "pending_recheck"];

const statLabels = ["入缸", "发酵中", "可抄纸", "异常观察"];
const seed = {
  items: [
    {
      code: "PF-001",
      source: "构树皮",
      vat: "三号缸",
      days: 5,
      owner: "林素",
      status: "发酵中",
      logs: [{ at: "2026-06-15", step: "观察", note: "温度24.6，气味微酸，纤维开始松散", abnormal: false }],
    },
  ],
};

// ---------- 基础工具 ----------
let seq = 0;
function uid(prefix) {
  seq += 1;
  return prefix + "-" + Date.now().toString(36) + "-" + seq.toString(36);
}
function nowIso() {
  return new Date().toISOString();
}
function fail(status, error, message, extra) {
  const err = new Error(message || error);
  err.status = status;
  err.error = error;
  err.extra = extra;
  throw err;
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "invalid_json", "请求体不是合法 JSON");
  }
}

// ---------- 持久化：原子写入，重启后完整恢复 ----------
async function saveDb(db) {
  const tmp = dbPath + ".tmp";
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dbPath);
}
async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await saveDb(JSON.parse(JSON.stringify(seed)));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (migrate(db)) await saveDb(db);
  return db;
}

// 升级迁移：保留已有缸具与发酵数据；历史缸具缺少清洗记录，标记“待补检”，绝不自动放行
function migrate(db) {
  let changed = false;
  db.items ||= [];
  db.vats ||= [];
  db.cleaningOrders ||= [];
  db.disinfectants ||= [];
  db.audit ||= [];
  const names = [...new Set(db.items.map((i) => i.vat).filter(Boolean))];
  for (const name of names) {
    if (!db.vats.some((v) => v.name === name)) {
      const item = db.items.find((i) => i.vat === name);
      const vat = {
        id: uid("V"),
        name,
        status: "pending_recheck",
        note: "历史数据迁移：缺少清洗与放行记录，标记待补检，须走完整清洗流程后方可使用",
        occupiedBy: item ? item.id || item.code : null,
        release: null,
        activeOrderId: null,
        createdAt: nowIso(),
      };
      db.vats.push(vat);
      audit(db, "system", "migrate_pending_recheck", "历史缸具「" + name + "」缺少清洗记录，标记为待补检", { vatId: vat.id });
      changed = true;
    }
  }
  for (const item of db.items) {
    const vat = db.vats.find((v) => v.name === item.vat);
    if (vat && !item.vatId) {
      item.vatId = vat.id;
      changed = true;
    }
  }
  if (!db.disinfectants.length) {
    db.disinfectants.push({ id: uid("D"), batch: "XD-2026-01", name: "次氯酸钠消毒剂", expiresAt: "2027-12-31", createdAt: nowIso() });
    changed = true;
  }
  return changed;
}

// 到期失效闭环：每次请求前扫描，放行有效期已过 → 缸具与工单同时失效
function sweep(db) {
  const now = Date.now();
  let changed = false;
  for (const vat of db.vats) {
    if (vat.status === "released" && vat.release && Date.parse(vat.release.validUntil) <= now) {
      vat.status = "expired";
      vat.expiredAt = new Date(now).toISOString();
      changed = true;
      audit(db, "system", "vat_expired", "缸具「" + vat.name + "」放行到期失效", { vatId: vat.id, orderId: vat.release.orderId });
      const order = db.cleaningOrders.find((o) => o.id === vat.release.orderId);
      if (order && order.status === "released") {
        order.status = "expired";
        order.expiredAt = vat.expiredAt;
      }
    }
  }
  for (const order of db.cleaningOrders) {
    if (order.status === "released" && order.release && Date.parse(order.release.validUntil) <= now) {
      order.status = "expired";
      order.expiredAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}

function audit(db, actor, action, detail, refs = {}) {
  db.audit.push({
    at: nowIso(),
    actor: actor || "system",
    action,
    vatId: refs.vatId || null,
    orderId: refs.orderId || null,
    itemId: refs.itemId || null,
    detail: detail || "",
  });
}

// ---------- 并发：所有请求串行处理，同一任务并发完成只成功一次 ----------
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- 视图 ----------
function findVat(db, key) {
  return db.vats.find((v) => v.id === key || v.name === key);
}
function vatView(db, vat) {
  const activeOrder = vat.activeOrderId ? db.cleaningOrders.find((o) => o.id === vat.activeOrderId) : null;
  const msLeft = vat.release ? Date.parse(vat.release.validUntil) - Date.now() : null;
  return {
    ...vat,
    statusLabel: VAT_STATUS[vat.status] || vat.status,
    dispatchable: DISPATCHABLE.includes(vat.status) && !vat.occupiedBy && !vat.activeOrderId,
    activeOrder: activeOrder ? { id: activeOrder.id, status: activeOrder.status, statusLabel: ORDER_STATUS[activeOrder.status], shift: activeOrder.shift } : null,
    releaseMsLeft: msLeft,
    expiringSoon: vat.status === "released" && msLeft !== null && msLeft <= EXPIRING_SOON_HOURS * 3600e3,
  };
}
function orderView(db, order) {
  const vat = db.vats.find((v) => v.id === order.vatId);
  return { ...order, vatName: vat ? vat.name : order.vatId, statusLabel: ORDER_STATUS[order.status] || order.status };
}
function itemView(db, item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  const vat = item.vatId ? db.vats.find((v) => v.id === item.vatId) : db.vats.find((v) => v.name === item.vat);
  return { ...item, logCount, vatStatus: vat ? vat.status : null, vatStatusLabel: vat ? VAT_STATUS[vat.status] : null };
}
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map((label) => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}

// ---------- 路由 ----------
async function route(req, res, url, db) {
  // ===== 发酵批次（保留原有功能） =====
  if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map((i) => itemView(db, i)));
  if (req.method === "POST" && url.pathname === "/api/items") {
    const input = await body(req);
    const vatKey = String(input.vat || "").trim();
    if (!vatKey) fail(400, "vat_required", "新建批次必须选择已放行的缸具");
    const vat = findVat(db, vatKey);
    if (!vat) fail(404, "vat_not_found", "缸具不存在：" + vatKey);
    if (vat.status === "quarantined") fail(409, "vat_quarantined", "缸具「" + vat.name + "」已隔离，不得投入批次");
    if (vat.status !== "released") {
      fail(409, "vat_not_released", "缸具「" + vat.name + "」当前状态为「" + VAT_STATUS[vat.status] + "」，未放行不得新建批次", { vatStatus: vat.status });
    }
    if (vat.occupiedBy) fail(409, "vat_occupied", "缸具「" + vat.name + "」正被批次 " + vat.occupiedBy + " 占用");
    const item = {
      ...input,
      id: uid("PF"),
      vat: vat.name,
      vatId: vat.id,
      logs: [{ at: nowIso(), step: "建档", note: "创建纸浆批次，投入缸具「" + vat.name + "」" }],
    };
    db.items.unshift(item);
    vat.occupiedBy = item.id;
    audit(db, input.owner || "system", "item_create", "批次 " + (item.code || item.id) + " 占用缸具「" + vat.name + "」", { vatId: vat.id, itemId: item.id });
    await saveDb(db);
    return send(res, 201, itemView(db, item));
  }
  const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (patch && req.method === "PATCH") {
    const item = db.items.find((x) => x.id === patch[1] || x.code === patch[1]);
    if (!item) return send(res, 404, { error: "item_not_found" });
    const input = await body(req);
    delete input.id;
    delete input.vat;
    delete input.vatId;
    delete input.logs;
    delete input.observations;
    Object.assign(item, input);
    item.logs ||= [];
    item.logs.push({ at: nowIso(), step: "状态", note: "更新为" + item.status });
    await saveDb(db);
    return send(res, 200, itemView(db, item));
  }
  const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
  if (log && req.method === "POST") {
    const item = db.items.find((x) => x.id === log[1] || x.code === log[1]);
    if (!item) return send(res, 404, { error: "item_not_found" });
    const input = await body(req);
    item.logs ||= [];
    item.logs.push({ at: nowIso(), step: input.step || "记录", note: input.note || "" });
    await saveDb(db);
    return send(res, 201, itemView(db, item));
  }
  const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
  if (action && req.method === "POST") {
    const item = db.items.find((x) => x.id === action[1] || x.code === action[1]);
    if (!item) return send(res, 404, { error: "item_not_found" });
    const input = await body(req);
    item.logs ||= [];
    const abnormal = String(input.abnormal || "").includes("是") || String(input.abnormal || "").includes("有");
    item.observations ||= [];
    item.observations.push({ at: nowIso(), ...input, abnormal });
    item.days = Number(item.days || 0) + 1;
    item.status = abnormal ? "异常观察" : Number(item.days) >= 7 ? "可抄纸" : "发酵中";
    item.logs.push({ at: nowIso(), step: "观察", note: "温度" + (input.temperature || "") + "，" + (input.smell || "") + "，" + (input.fiber || "") });
    await saveDb(db);
    return send(res, 201, itemView(db, item));
  }
  // 换缸：目标缸具必须已放行且空闲；失败不得改动任何占用与审计
  const swap = url.pathname.match(/^\/api\/items\/([^/]+)\/swap-vat$/);
  if (swap && req.method === "POST") {
    const item = db.items.find((x) => x.id === swap[1] || x.code === swap[1]);
    if (!item) fail(404, "item_not_found", "批次不存在");
    const input = await body(req);
    const key = String(input.vat || "").trim();
    if (!key) fail(400, "vat_required", "必须指定目标缸具");
    const target = findVat(db, key);
    if (!target) fail(404, "vat_not_found", "目标缸具不存在：" + key);
    if (item.vatId === target.id) fail(400, "same_vat", "目标缸具与当前缸具相同");
    if (target.status === "quarantined") fail(409, "vat_quarantined", "缸具「" + target.name + "」已隔离，不得换入");
    if (target.status !== "released") {
      fail(409, "vat_not_released", "缸具「" + target.name + "」当前状态为「" + VAT_STATUS[target.status] + "」，未放行不得换入批次", { vatStatus: target.status });
    }
    if (target.occupiedBy) fail(409, "vat_occupied", "缸具「" + target.name + "」正被批次 " + target.occupiedBy + " 占用");
    const itemKey = item.id || item.code;
    const old = item.vatId ? db.vats.find((v) => v.id === item.vatId) : db.vats.find((v) => v.name === item.vat);
    // 全部校验通过后才改动：旧缸释放转待清洗，新缸占用
    if (old && old.occupiedBy === itemKey) {
      old.occupiedBy = null;
      old.status = "dirty";
      old.release = null;
      old.activeOrderId = null;
      old.note = "批次换出，使用后待清洗";
      audit(db, input.operator || item.owner || "system", "vat_vacated", "批次 " + (item.code || itemKey) + " 换出，缸具「" + old.name + "」转为待清洗", { vatId: old.id, itemId: itemKey });
    }
    target.occupiedBy = itemKey;
    item.vat = target.name;
    item.vatId = target.id;
    item.logs ||= [];
    item.logs.push({ at: nowIso(), step: "换缸", note: "换入缸具「" + target.name + "」" });
    audit(db, input.operator || item.owner || "system", "item_swap_vat", "批次 " + (item.code || itemKey) + " 换入缸具「" + target.name + "」", { vatId: target.id, itemId: itemKey });
    await saveDb(db);
    return send(res, 200, itemView(db, item));
  }
  if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));

  // ===== 缸具建档 =====
  if (req.method === "GET" && url.pathname === "/api/vats") {
    let list = db.vats;
    const status = url.searchParams.get("status");
    if (status) list = list.filter((v) => v.status === status);
    const q = (url.searchParams.get("q") || "").trim();
    if (q) list = list.filter((v) => v.name.includes(q));
    let views = list.map((v) => vatView(db, v));
    if (url.searchParams.get("usable") === "1") views = views.filter((v) => v.status === "released" && !v.occupiedBy);
    return send(res, 200, views);
  }
  if (req.method === "POST" && url.pathname === "/api/vats") {
    const input = await body(req);
    const name = String(input.name || "").trim();
    if (!name) fail(400, "name_required", "缸具名称必填");
    if (db.vats.some((v) => v.name === name)) fail(409, "vat_exists", "缸具「" + name + "」已存在");
    const vat = { id: uid("V"), name, status: "dirty", note: String(input.note || ""), occupiedBy: null, release: null, activeOrderId: null, createdAt: nowIso() };
    db.vats.push(vat);
    audit(db, input.actor || "system", "vat_register", "缸具「" + name + "」建档，状态待清洗", { vatId: vat.id });
    await saveDb(db);
    return send(res, 201, vatView(db, vat));
  }
  const quarantine = url.pathname.match(/^\/api\/vats\/([^/]+)\/quarantine$/);
  if (quarantine && req.method === "POST") {
    const vat = findVat(db, decodeURIComponent(quarantine[1]));
    if (!vat) fail(404, "vat_not_found", "缸具不存在");
    const input = await body(req);
    if (vat.status === "quarantined") fail(409, "already_quarantined", "缸具已处于隔离状态");
    if (vat.occupiedBy) fail(409, "vat_occupied", "缸具正被批次占用，不能隔离");
    if (vat.activeOrderId) fail(409, "vat_busy", "缸具存在进行中的清洗工单，不能隔离");
    vat.quarantine = { by: input.actor || "system", reason: String(input.reason || ""), at: nowIso(), from: vat.status };
    vat.status = "quarantined";
    vat.release = null;
    audit(db, vat.quarantine.by, "vat_quarantine", "缸具「" + vat.name + "」隔离" + (vat.quarantine.reason ? "：" + vat.quarantine.reason : ""), { vatId: vat.id });
    await saveDb(db);
    return send(res, 200, vatView(db, vat));
  }
  const unquarantine = url.pathname.match(/^\/api\/vats\/([^/]+)\/unquarantine$/);
  if (unquarantine && req.method === "POST") {
    const vat = findVat(db, decodeURIComponent(unquarantine[1]));
    if (!vat) fail(404, "vat_not_found", "缸具不存在");
    const input = await body(req);
    if (vat.status !== "quarantined") fail(409, "not_quarantined", "缸具未处于隔离状态");
    vat.status = "dirty";
    vat.note = "解除隔离，须重新清洗放行";
    vat.quarantine = null;
    audit(db, input.actor || "system", "vat_unquarantine", "缸具「" + vat.name + "」解除隔离，转为待清洗", { vatId: vat.id });
    await saveDb(db);
    return send(res, 200, vatView(db, vat));
  }

  // ===== 消毒剂批次 =====
  if (req.method === "GET" && url.pathname === "/api/disinfectants") {
    const views = db.disinfectants.map((d) => ({ ...d, expired: new Date(d.expiresAt + "T23:59:59").getTime() < Date.now() }));
    return send(res, 200, views);
  }
  if (req.method === "POST" && url.pathname === "/api/disinfectants") {
    const input = await body(req);
    const batch = String(input.batch || "").trim();
    const name = String(input.name || "").trim();
    const expiresAt = String(input.expiresAt || "").trim();
    if (!batch || !name || !expiresAt) fail(400, "missing_fields", "批次号、名称、有效期必填");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) fail(400, "expires_at_invalid", "有效期格式须为 YYYY-MM-DD");
    if (db.disinfectants.some((d) => d.batch === batch)) fail(409, "duplicate_batch", "消毒剂批次「" + batch + "」已存在");
    const dis = { id: uid("D"), batch, name, expiresAt, createdAt: nowIso() };
    db.disinfectants.push(dis);
    audit(db, input.actor || "system", "disinfectant_add", "登记消毒剂批次「" + batch + "」（" + name + "），有效期至 " + expiresAt);
    await saveDb(db);
    return send(res, 201, dis);
  }

  // ===== 清洗工单：派单 → 领单 → 参数登记 → 复检 → 放行 → 到期失效 =====
  if (req.method === "GET" && url.pathname === "/api/cleaning-orders") {
    let list = db.cleaningOrders;
    const vatId = url.searchParams.get("vatId");
    if (vatId) list = list.filter((o) => o.vatId === vatId);
    const shift = url.searchParams.get("shift");
    if (shift) list = list.filter((o) => o.shift === shift);
    const status = url.searchParams.get("status");
    if (status) list = list.filter((o) => o.status === status);
    const released = url.searchParams.get("released");
    if (released === "true") list = list.filter((o) => o.status === "released");
    if (released === "false") list = list.filter((o) => o.status !== "released");
    const expiry = url.searchParams.get("expiry");
    if (expiry === "expired") list = list.filter((o) => o.status === "expired");
    if (expiry === "expiring") list = list.filter((o) => o.status === "released" && o.release && Date.parse(o.release.validUntil) - Date.now() <= EXPIRING_SOON_HOURS * 3600e3);
    if (expiry === "valid") list = list.filter((o) => o.status === "released" && o.release && Date.parse(o.release.validUntil) - Date.now() > EXPIRING_SOON_HOURS * 3600e3);
    return send(res, 200, list.map((o) => orderView(db, o)));
  }
  if (req.method === "POST" && url.pathname === "/api/cleaning-orders") {
    const input = await body(req);
    const vat = findVat(db, String(input.vatId || input.vat || "").trim());
    if (!vat) fail(404, "vat_not_found", "缸具不存在");
    if (!SHIFTS.includes(input.shift)) fail(400, "shift_invalid", "班次必须是：" + SHIFTS.join("、"));
    if (vat.status === "quarantined") fail(409, "vat_quarantined", "缸具已隔离，不能派单");
    if (vat.occupiedBy) fail(409, "vat_occupied", "缸具正被批次占用，不能派单清洗");
    if (vat.activeOrderId) fail(409, "vat_busy", "缸具已有进行中的清洗工单");
    if (!DISPATCHABLE.includes(vat.status)) fail(409, "vat_not_dispatchable", "缸具当前状态为「" + VAT_STATUS[vat.status] + "」，不能派单");
    const order = {
      id: uid("CL"),
      vatId: vat.id,
      shift: input.shift,
      status: "dispatched",
      dispatchedBy: String(input.dispatchedBy || "台账员"),
      dispatchedAt: nowIso(),
      claimedBy: null,
      claimedAt: null,
      cleaning: null,
      recheck: null,
      release: null,
      rejectedReason: null,
    };
    db.cleaningOrders.unshift(order);
    vat.activeOrderId = order.id;
    vat.status = "cleaning";
    audit(db, order.dispatchedBy, "order_dispatch", "缸具「" + vat.name + "」派出清洗工单 " + order.id + "（" + order.shift + "）", { vatId: vat.id, orderId: order.id });
    await saveDb(db);
    return send(res, 201, orderView(db, order));
  }
  const claim = url.pathname.match(/^\/api\/cleaning-orders\/([^/]+)\/claim$/);
  if (claim && req.method === "POST") {
    const order = db.cleaningOrders.find((o) => o.id === claim[1]);
    if (!order) fail(404, "order_not_found", "工单不存在");
    const input = await body(req);
    const operator = String(input.operator || "").trim();
    if (!operator) fail(400, "operator_required", "领单必须填写操作人");
    if (order.status !== "dispatched") {
      fail(409, "order_not_claimable", "工单当前状态为「" + ORDER_STATUS[order.status] + "」，不能重复领单", { orderStatus: order.status, claimedBy: order.claimedBy });
    }
    order.status = "claimed";
    order.claimedBy = operator;
    order.claimedAt = nowIso();
    audit(db, operator, "order_claim", "工单 " + order.id + " 由 " + operator + " 领单", { vatId: order.vatId, orderId: order.id });
    await saveDb(db);
    return send(res, 200, orderView(db, order));
  }
  const cleaning = url.pathname.match(/^\/api\/cleaning-orders\/([^/]+)\/cleaning$/);
  if (cleaning && req.method === "POST") {
    const order = db.cleaningOrders.find((o) => o.id === cleaning[1]);
    if (!order) fail(404, "order_not_found", "工单不存在");
    if (order.status !== "claimed") fail(409, "order_not_submittable", "工单当前状态为「" + ORDER_STATUS[order.status] + "」，不能登记清洗参数", { orderStatus: order.status });
    const input = await body(req);
    // 第一关：温度、浓度、时长、操作人、消毒剂批次齐全才可提交
    const missing = [];
    const values = {};
    for (const [key, rule] of Object.entries(CLEAN_RULES)) {
      const raw = input[key];
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        missing.push(rule.label);
        continue;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        missing.push(rule.label + "（需为数字）");
        continue;
      }
      values[key] = num;
    }
    const operator = String(input.operator || "").trim();
    if (!operator) missing.push("操作人");
    const batch = String(input.disinfectantBatch || "").trim();
    if (!batch) missing.push("消毒剂批次");
    if (missing.length) fail(400, "missing_fields", "清洗参数不全，缺少：" + missing.join("、") + "；工单保持已领单状态，可补全后重新提交", { missing });
    // 第二关：越界或批次过期 → 整单拒绝。失败请求完全回滚：不改动工单、缸具、占用与审计
    const reasons = [];
    for (const [key, rule] of Object.entries(CLEAN_RULES)) {
      if (values[key] < rule.min || values[key] > rule.max) reasons.push(rule.label + " " + values[key] + rule.unit + " 超出范围 " + rule.min + "–" + rule.max + rule.unit);
    }
    const dis = db.disinfectants.find((d) => d.batch === batch);
    if (!dis) reasons.push("消毒剂批次「" + batch + "」不存在");
    else if (new Date(dis.expiresAt + "T23:59:59").getTime() < Date.now()) reasons.push("消毒剂批次「" + batch + "」已于 " + dis.expiresAt + " 过期");
    if (reasons.length) {
      return send(res, 422, { error: "cleaning_rejected", message: "清洗参数越界或消毒剂批次过期，整单拒绝：" + reasons.join("；") + "。工单保持已领单状态，可修正后重新提交", reasons });
    }
    const vat = db.vats.find((v) => v.id === order.vatId);
    order.cleaning = { ...values, operator, disinfectantBatch: batch, at: nowIso() };
    order.status = "recheck";
    if (vat) vat.status = "recheck";
    audit(db, operator, "cleaning_submit", "工单 " + order.id + " 清洗参数登记完成（温度" + values.temperature + "℃，浓度" + values.concentration + "%，时长" + values.durationMinutes + "分钟，批次" + batch + "）", { vatId: order.vatId, orderId: order.id });
    await saveDb(db);
    return send(res, 200, orderView(db, order));
  }
  const recheck = url.pathname.match(/^\/api\/cleaning-orders\/([^/]+)\/recheck$/);
  if (recheck && req.method === "POST") {
    const order = db.cleaningOrders.find((o) => o.id === recheck[1]);
    if (!order) fail(404, "order_not_found", "工单不存在");
    if (order.status !== "recheck") fail(409, "order_not_checkable", "工单当前状态为「" + ORDER_STATUS[order.status] + "」，不能复检", { orderStatus: order.status });
    const input = await body(req);
    const inspector = String(input.inspector || "").trim();
    if (!inspector) fail(400, "inspector_required", "复检人必填");
    const raw = String(input.result || "").trim();
    const result = raw === "pass" || raw === "通过" ? "pass" : raw === "fail" || raw === "不通过" ? "fail" : null;
    if (!result) fail(400, "result_invalid", "复检结果必须是 通过/不通过");
    if (order.cleaning && inspector === order.cleaning.operator) fail(400, "same_person", "复检人不能与操作人相同（操作人：" + order.cleaning.operator + "）");
    const note = String(input.note || "");
    const vat = db.vats.find((v) => v.id === order.vatId);
    order.recheck = { inspector, result, note, at: nowIso() };
    if (result === "fail") {
      order.status = "rejected";
      order.rejectedReason = "复检不通过" + (note ? "：" + note : "");
      order.rejectedAt = nowIso();
      if (vat && vat.activeOrderId === order.id) {
        vat.activeOrderId = null;
        vat.status = "dirty";
      }
      audit(db, inspector, "recheck_fail", "工单 " + order.id + " 复检不通过，整单拒绝", { vatId: order.vatId, orderId: order.id });
    } else {
      order.status = "rechecked";
      if (vat) vat.status = "pending_release";
      audit(db, inspector, "recheck_pass", "工单 " + order.id + " 复检通过，待放行", { vatId: order.vatId, orderId: order.id });
    }
    await saveDb(db);
    return send(res, 200, orderView(db, order));
  }
  const release = url.pathname.match(/^\/api\/cleaning-orders\/([^/]+)\/release$/);
  if (release && req.method === "POST") {
    const order = db.cleaningOrders.find((o) => o.id === release[1]);
    if (!order) fail(404, "order_not_found", "工单不存在");
    if (order.status !== "rechecked") fail(409, "order_not_releasable", "工单当前状态为「" + ORDER_STATUS[order.status] + "」，不能放行", { orderStatus: order.status });
    const input = await body(req);
    const releasedBy = String(input.releasedBy || "").trim();
    if (!releasedBy) fail(400, "released_by_required", "放行人必填");
    const hours = input.validHours === undefined || input.validHours === null || String(input.validHours).trim() === "" ? DEFAULT_VALID_HOURS : Number(input.validHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_VALID_HOURS) fail(400, "valid_hours_invalid", "放行有效期需为 0–" + MAX_VALID_HOURS + " 小时");
    const validUntil = new Date(Date.now() + hours * 3600e3).toISOString();
    const vat = db.vats.find((v) => v.id === order.vatId);
    order.release = { releasedBy, at: nowIso(), validUntil };
    order.status = "released";
    if (vat) {
      vat.status = "released";
      vat.release = { orderId: order.id, releasedBy, at: nowIso(), validUntil };
      vat.activeOrderId = null;
      vat.note = "";
    }
    audit(db, releasedBy, "order_release", "工单 " + order.id + " 放行，缸具「" + (vat ? vat.name : order.vatId) + "」有效期至 " + validUntil, { vatId: order.vatId, orderId: order.id });
    await saveDb(db);
    return send(res, 200, orderView(db, order));
  }

  // ===== 审计与配置 =====
  if (req.method === "GET" && url.pathname === "/api/audit") {
    let list = [...db.audit].reverse();
    const vatId = url.searchParams.get("vatId");
    if (vatId) list = list.filter((a) => a.vatId === vatId);
    const orderId = url.searchParams.get("orderId");
    if (orderId) list = list.filter((a) => a.orderId === orderId);
    return send(res, 200, list);
  }
  if (req.method === "GET" && url.pathname === "/api/config") {
    return send(res, 200, {
      shifts: SHIFTS,
      cleanRules: CLEAN_RULES,
      defaultValidHours: DEFAULT_VALID_HOURS,
      maxValidHours: MAX_VALID_HOURS,
      expiringSoonHours: EXPIRING_SOON_HOURS,
      vatStatusLabels: VAT_STATUS,
      orderStatusLabels: ORDER_STATUS,
    });
  }
  send(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not_found" });
    await withLock(async () => {
      const db = await loadDb();
      if (sweep(db)) await saveDb(db);
      await route(req, res, url, db);
    });
  } catch (error) {
    send(res, error.status || 500, { error: error.error || "internal_error", message: error.message, ...(error.extra || {}) });
  }
});
server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
