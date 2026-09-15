// 缸具清洗与复用放行 —— 全流程走通测试
// 覆盖：迁移保留、领单、参数登记（缺项/越界/批次过期）、复检人≠操作人、放行、
//       换缸、到期拦截、并发只成功一次、失败不改占用与审计、重启恢复、接口筛选
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function ok(cond, name, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.error("  ✗ " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
  }
}
async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body) init.headers = { "Content-Type": "application/json" };
  const res = await fetch(BASE + path, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + "/api/items");
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("server did not start");
}
function start(dbPath) {
  const child = spawn(process.execPath, [join(root, "server.js")], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((r) => child.on("exit", r)), sleep(3000)]);
}

// 走通一条完整的 派单→领单→清洗→复检→放行 流程
async function cleanAndRelease(vatId, { operator = "张三", inspector = "李四", releasedBy = "王班长", validHours = 72, batch = "D-OK", shift = "早班" } = {}) {
  const d = await post("/api/cleaning-orders", { vatId, shift, dispatchedBy: "王班长" });
  if (d.status !== 201) return { error: "dispatch", resp: d };
  const oid = d.data.id;
  const c = await post(`/api/cleaning-orders/${oid}/claim`, { operator });
  if (c.status !== 200) return { error: "claim", resp: c };
  const cl = await post(`/api/cleaning-orders/${oid}/cleaning`, { temperature: 85, concentration: 2.5, durationMinutes: 40, operator, disinfectantBatch: batch });
  if (cl.status !== 200) return { error: "cleaning", resp: cl };
  const rc = await post(`/api/cleaning-orders/${oid}/recheck`, { inspector, result: "pass" });
  if (rc.status !== 200) return { error: "recheck", resp: rc };
  const rl = await post(`/api/cleaning-orders/${oid}/release`, { releasedBy, validHours });
  if (rl.status !== 200) return { error: "release", resp: rl };
  return { orderId: oid };
}

const tmp = await mkdtemp(join(tmpdir(), "ferment-"));
const dbPath = join(tmp, "db.json");
// 旧版数据：只有发酵批次，没有缸具/工单结构
await writeFile(dbPath, JSON.stringify({
  items: [{ code: "PF-OLD", source: "构树皮", vat: "老缸", days: 3, owner: "林素", status: "发酵中", logs: [{ at: "2026-06-15", step: "观察", note: "历史记录" }] }],
}));

let server = start(dbPath);
await waitUp();

console.log("\n[A] 升级迁移：保留数据，历史缺项标待补检，不自动放行");
{
  const items = await api("/api/items");
  ok(items.status === 200 && items.data.length === 1 && items.data[0].code === "PF-OLD", "历史发酵批次保留");
  ok(items.data[0].logs.some((l) => l.note === "历史记录"), "历史日志保留");
  const vats = await api("/api/vats");
  const legacy = vats.data.find((v) => v.name === "老缸");
  ok(!!legacy, "历史缸具自动建档");
  ok(legacy && legacy.status === "pending_recheck", "历史缸具标记为待补检", legacy && legacy.status);
  ok(legacy && legacy.status !== "released", "历史缸具未被自动放行");
  ok(legacy && legacy.occupiedBy === "PF-OLD", "历史占用关系保留", legacy && legacy.occupiedBy);
  const audit = await api("/api/audit");
  ok(audit.data.some((a) => a.action === "migrate_pending_recheck"), "迁移动作写入审计");
  const bad = await post("/api/items", { code: "PF-X1", vat: "老缸", owner: "林素" });
  ok(bad.status === 409 && bad.data.error === "vat_not_released", "待补检缸具不得新建批次", bad);
}

console.log("\n[B] 建档 → 派单 → 领单 → 参数登记 → 复检 → 放行");
{
  await post("/api/disinfectants", { batch: "D-OK", name: "次氯酸钠", expiresAt: "2027-01-01" });
  await post("/api/disinfectants", { batch: "D-EXP", name: "过氧乙酸", expiresAt: "2020-01-01" });

  const v = await post("/api/vats", { name: "一号缸", note: "东车间" });
  ok(v.status === 201 && v.data.status === "dirty", "缸具建档，初始待清洗");
  const dup = await post("/api/vats", { name: "一号缸" });
  ok(dup.status === 409, "缸具重名拒绝", dup.status);
  const vatId = v.data.id;

  const noShift = await post("/api/cleaning-orders", { vatId });
  ok(noShift.status === 400, "缺班次不能派单", noShift.status);
  const d = await post("/api/cleaning-orders", { vatId, shift: "早班", dispatchedBy: "王班长" });
  ok(d.status === 201 && d.data.status === "dispatched", "派单成功");
  const orderId = d.data.id;
  const d2 = await post("/api/cleaning-orders", { vatId, shift: "中班" });
  ok(d2.status === 409, "已有进行工单时重复派单被拒", d2.status);

  const noOp = await post(`/api/cleaning-orders/${orderId}/claim`, {});
  ok(noOp.status === 400, "领单缺操作人被拒", noOp.status);
  const c = await post(`/api/cleaning-orders/${orderId}/claim`, { operator: "张三" });
  ok(c.status === 200 && c.data.status === "claimed", "领单成功");
  const c2 = await post(`/api/cleaning-orders/${orderId}/claim`, { operator: "李四" });
  ok(c2.status === 409, "重复领单被拒（只成功一次）", c2.status);

  const miss = await post(`/api/cleaning-orders/${orderId}/cleaning`, { temperature: 85 });
  ok(miss.status === 400 && miss.data.error === "missing_fields", "参数不齐全不可提交", miss);
  const stillClaimed = await api("/api/cleaning-orders?status=claimed");
  ok(stillClaimed.data.some((o) => o.id === orderId), "缺项失败后工单保持已领单，可补录");

  // 422 必须完全回滚：越界与批次过期，状态、占用、审计保持请求前不变
  const pick = (v) => ({ id: v.id, status: v.status, occupiedBy: v.occupiedBy, activeOrderId: v.activeOrderId, release: v.release });
  const snapVats = (await api("/api/vats")).data.map(pick);
  const snapOrders = (await api("/api/cleaning-orders")).data.map((o) => ({ id: o.id, status: o.status, cleaning: o.cleaning, claimedBy: o.claimedBy }));
  const snapAuditLen = (await api("/api/audit")).data.length;
  const oor = await post(`/api/cleaning-orders/${orderId}/cleaning`, { temperature: 30, concentration: 2.5, durationMinutes: 40, operator: "张三", disinfectantBatch: "D-OK" });
  ok(oor.status === 422 && oor.data.error === "cleaning_rejected", "温度越界返回422整单拒绝", oor);
  const exp = await post(`/api/cleaning-orders/${orderId}/cleaning`, { temperature: 85, concentration: 2.5, durationMinutes: 40, operator: "张三", disinfectantBatch: "D-EXP" });
  ok(exp.status === 422 && exp.data.error === "cleaning_rejected", "消毒剂批次过期返回422整单拒绝", exp);
  const afterVats = (await api("/api/vats")).data.map(pick);
  const afterOrders = (await api("/api/cleaning-orders")).data.map((o) => ({ id: o.id, status: o.status, cleaning: o.cleaning, claimedBy: o.claimedBy }));
  const afterAuditLen = (await api("/api/audit")).data.length;
  ok(JSON.stringify(afterVats) === JSON.stringify(snapVats), "422后缸具状态与活动工单完全未变");
  ok(JSON.stringify(afterOrders) === JSON.stringify(snapOrders), "422后工单状态完全未变");
  ok(afterAuditLen === snapAuditLen, "422后不新增审计", { before: snapAuditLen, after: afterAuditLen });
  const orderAfter = afterOrders.find((o) => o.id === orderId);
  ok(orderAfter.status === "claimed" && !orderAfter.cleaning, "工单保持已领单且未写入参数", orderAfter);

  // 回滚后同一工单可修正重提，继续走通
  const good = await post(`/api/cleaning-orders/${orderId}/cleaning`, { temperature: 85, concentration: 2.5, durationMinutes: 40, operator: "张三", disinfectantBatch: "D-OK" });
  ok(good.status === 200 && good.data.status === "recheck", "修正后重新提交成功转复检");
  const same = await post(`/api/cleaning-orders/${orderId}/recheck`, { inspector: "张三", result: "pass" });
  ok(same.status === 400 && same.data.error === "same_person", "复检人与操作人相同被拒", same);
  const rc = await post(`/api/cleaning-orders/${orderId}/recheck`, { inspector: "李四", result: "pass" });
  ok(rc.status === 200 && rc.data.status === "rechecked", "复检通过待放行");
  const earlyRelease = await api("/api/vats?usable=1");
  ok(!earlyRelease.data.some((x) => x.id === vatId), "未放行的缸具不可用于批次");
  const rl = await post(`/api/cleaning-orders/${orderId}/release`, { releasedBy: "王班长", validHours: 72 });
  ok(rl.status === 200 && rl.data.status === "released" && rl.data.release.validUntil, "放行成功并带有效期");
  const rl2 = await post(`/api/cleaning-orders/${orderId}/release`, { releasedBy: "王班长" });
  ok(rl2.status === 409, "重复放行被拒（只成功一次）", rl2.status);
  const vats = await api("/api/vats");
  ok(vats.data.find((x) => x.id === vatId).status === "released", "缸具状态=已放行");
}

console.log("\n[C] 批次占用、换缸、未放行/隔离拦截");
{
  const mk = await post("/api/items", { code: "PF-100", source: "桑皮", vat: "一号缸", days: 0, owner: "林素", status: "入缸" });
  ok(mk.status === 201, "已放行缸具可新建批次");
  const again = await post("/api/items", { code: "PF-101", vat: "一号缸", owner: "林素" });
  ok(again.status === 409 && again.data.error === "vat_occupied", "占用中缸具不得重复新建", again);
  const ghost = await post("/api/items", { code: "PF-102", vat: "不存在缸" });
  ok(ghost.status === 404, "缸具不存在报错", ghost.status);

  // 二号缸走完整流程后放行
  const v2 = await post("/api/vats", { name: "二号缸" });
  const flow = await cleanAndRelease(v2.data.id, { shift: "中班" });
  ok(!flow.error, "二号缸清洗放行流程走通", flow);

  const sw = await post(`/api/items/${mk.data.id}/swap-vat`, { vat: "二号缸", operator: "林素" });
  ok(sw.status === 200 && sw.data.vat === "二号缸", "换缸成功");
  let vats = await api("/api/vats");
  ok(vats.data.find((x) => x.name === "一号缸").status === "dirty", "换出后旧缸转待清洗");
  ok(vats.data.find((x) => x.name === "二号缸").occupiedBy === mk.data.id, "新缸被占用");
  const swBack = await post(`/api/items/${mk.data.id}/swap-vat`, { vat: "一号缸" });
  ok(swBack.status === 409 && swBack.data.error === "vat_not_released", "换入未放行缸具被拦截", swBack);

  // 隔离：占用中不可隔离；空闲可隔离；隔离缸具不可换入、不可派单
  const qBusy = await post("/api/vats/二号缸/quarantine", { reason: "疑似污染" });
  ok(qBusy.status === 409, "占用中缸具不能隔离", qBusy.status);
  const q = await post("/api/vats/一号缸/quarantine", { reason: "缸壁裂纹" });
  ok(q.status === 200 && q.data.status === "quarantined", "空闲缸具隔离成功");
  const swQ = await post(`/api/items/${mk.data.id}/swap-vat`, { vat: "一号缸" });
  ok(swQ.status === 409 && swQ.data.error === "vat_quarantined", "隔离缸具不得换入", swQ);
  const dQ = await post("/api/cleaning-orders", { vatId: "一号缸", shift: "早班" });
  ok(dQ.status === 409, "隔离缸具不能派单", dQ.status);
  const uq = await post("/api/vats/一号缸/unquarantine", {});
  ok(uq.status === 200 && uq.data.status === "dirty", "解除隔离后回待清洗");
}

console.log("\n[D] 失败操作不改动占用与审计");
{
  const before = await api("/api/audit");
  const vatsBefore = await api("/api/vats");
  const occupyBefore = Object.fromEntries(vatsBefore.data.map((v) => [v.name, v.occupiedBy || null]));
  await post("/api/items", { code: "PF-BAD", vat: "一号缸" }); // 未放行
  await post("/api/items", { code: "PF-BAD2", vat: "二号缸" }); // 占用中
  await post("/api/items/PF-100/swap-vat", { vat: "老缸" }); // 待补检
  await post("/api/items/PF-100/swap-vat", { vat: "不存在缸" }); // 不存在
  await post("/api/cleaning-orders", { vatId: "二号缸", shift: "早班" }); // 占用中派单
  await post("/api/cleaning-orders/nonexistent/claim", { operator: "张三" }); // 工单不存在
  const after = await api("/api/audit");
  const vatsAfter = await api("/api/vats");
  const occupyAfter = Object.fromEntries(vatsAfter.data.map((v) => [v.name, v.occupiedBy || null]));
  ok(after.data.length === before.data.length, "失败操作不新增审计", { before: before.data.length, after: after.data.length });
  ok(JSON.stringify(occupyBefore) === JSON.stringify(occupyAfter), "失败操作不改动占用", { occupyBefore, occupyAfter });
}

console.log("\n[E] 并发：同一任务只成功一次");
{
  const v = await post("/api/vats", { name: "三号缸" });
  const d = await post("/api/cleaning-orders", { vatId: v.data.id, shift: "早班" });
  const claims = await Promise.all([
    post(`/api/cleaning-orders/${d.data.id}/claim`, { operator: "张三" }),
    post(`/api/cleaning-orders/${d.data.id}/claim`, { operator: "李四" }),
    post(`/api/cleaning-orders/${d.data.id}/claim`, { operator: "王五" }),
  ]);
  ok(claims.filter((r) => r.status === 200).length === 1, "并发领单只有一人成功", claims.map((r) => r.status));
  ok(claims.filter((r) => r.status === 409).length === 2, "其余并发领单返回冲突", claims.map((r) => r.status));

  const winner = claims.find((r) => r.status === 200).data.claimedBy;
  const cleans = await Promise.all([
    post(`/api/cleaning-orders/${d.data.id}/cleaning`, { temperature: 85, concentration: 2.5, durationMinutes: 40, operator: winner, disinfectantBatch: "D-OK" }),
    post(`/api/cleaning-orders/${d.data.id}/cleaning`, { temperature: 90, concentration: 3, durationMinutes: 50, operator: winner, disinfectantBatch: "D-OK" }),
  ]);
  ok(cleans.filter((r) => r.status === 200).length === 1, "并发提交清洗参数只成功一次", cleans.map((r) => r.status));

  await post(`/api/cleaning-orders/${d.data.id}/recheck`, { inspector: "李四", result: "pass" });
  const releases = await Promise.all([
    post(`/api/cleaning-orders/${d.data.id}/release`, { releasedBy: "王班长" }),
    post(`/api/cleaning-orders/${d.data.id}/release`, { releasedBy: "赵六" }),
  ]);
  ok(releases.filter((r) => r.status === 200).length === 1, "并发放行只成功一次", releases.map((r) => r.status));
}

console.log("\n[F] 到期失效闭环与到期拦截");
{
  const v = await post("/api/vats", { name: "四号缸" });
  const flow = await cleanAndRelease(v.data.id, { validHours: 0.0003 }); // ≈1.08 秒
  ok(!flow.error, "短有效期放行成功", flow);
  await sleep(1600);
  const vats = await api("/api/vats"); // 请求触发到期扫描
  const vat = vats.data.find((x) => x.name === "四号缸");
  ok(vat.status === "expired", "到期后缸具自动失效", vat.status);
  const orders = await api("/api/cleaning-orders?status=expired");
  ok(orders.data.some((o) => o.id === flow.orderId), "对应工单同步失效");
  const blocked = await post("/api/items", { code: "PF-EXP", vat: "四号缸" });
  ok(blocked.status === 409 && blocked.data.error === "vat_not_released", "已失效缸具新建批次被拦截", blocked);
  const swExp = await post("/api/items/PF-100/swap-vat", { vat: "四号缸" });
  ok(swExp.status === 409, "已失效缸具换入被拦截", swExp);
  const audit = await api("/api/audit");
  ok(audit.data.some((a) => a.action === "vat_expired"), "到期失效写入审计");
}

console.log("\n[G] 接口筛选（缸具/班次/放行/到期）");
{
  const byShift = await api("/api/cleaning-orders?shift=中班");
  ok(byShift.data.length > 0 && byShift.data.every((o) => o.shift === "中班"), "按班次筛选");
  const vats = await api("/api/vats");
  const vid = vats.data.find((x) => x.name === "三号缸").id;
  const byVat = await api(`/api/cleaning-orders?vatId=${vid}`);
  ok(byVat.data.length > 0 && byVat.data.every((o) => o.vatId === vid), "按缸具筛选");
  const rel = await api("/api/cleaning-orders?released=true");
  ok(rel.data.every((o) => o.status === "released"), "按已放行筛选");
  const exp = await api("/api/cleaning-orders?expiry=expired");
  ok(exp.data.length > 0 && exp.data.every((o) => o.status === "expired"), "按已到期筛选");
  const usable = await api("/api/vats?usable=1");
  ok(usable.data.every((v) => v.status === "released" && !v.occupiedBy), "可用缸具筛选");
}

console.log("\n[H] 重启恢复");
{
  const auditBefore = await api("/api/audit");
  await stop(server);
  server = start(dbPath);
  await waitUp();
  const vats = await api("/api/vats");
  const legacy = vats.data.find((x) => x.name === "老缸");
  ok(legacy && legacy.status === "pending_recheck", "重启后历史缸具仍待补检，未自动放行");
  const v2 = vats.data.find((x) => x.name === "二号缸");
  ok(v2 && v2.status === "released" && v2.occupiedBy, "重启后放行与占用状态保留", v2 && { status: v2.status, occupiedBy: v2.occupiedBy });
  const v4 = vats.data.find((x) => x.name === "四号缸");
  ok(v4 && v4.status === "expired", "重启后已失效状态保留");
  const items = await api("/api/items");
  ok(items.data.find((i) => i.code === "PF-100") && items.data.find((i) => i.code === "PF-100").vat === "二号缸", "重启后批次换缸结果保留");
  const auditAfter = await api("/api/audit");
  ok(auditAfter.data.length >= auditBefore.data.length, "重启后审计日志完整", { before: auditBefore.data.length, after: auditAfter.data.length });
  // 重启后流程可继续：老缸被历史批次占用，须先换缸腾出，再走完整清洗流程
  const occupiedDispatch = await post("/api/cleaning-orders", { vatId: legacy.id, shift: "早班" });
  ok(occupiedDispatch.status === 409, "占用中的历史缸具不能直接派单清洗", occupiedDispatch.status);
  const swOld = await post("/api/items/PF-OLD/swap-vat", { vat: "三号缸", operator: "林素" });
  ok(swOld.status === 200 && swOld.data.vat === "三号缸", "历史批次换入已放行缸具", swOld);
  const freed = (await api("/api/vats")).data.find((x) => x.name === "老缸");
  ok(freed.status === "dirty" && !freed.occupiedBy, "换出后历史缸具转待清洗", freed && { status: freed.status, occupiedBy: freed.occupiedBy });
  const flow = await cleanAndRelease(legacy.id, { shift: "晚班" });
  ok(!flow.error, "重启后历史缸具可走完整清洗放行流程", flow);
  const mk = await post("/api/items", { code: "PF-200", vat: "老缸", owner: "林素" });
  ok(mk.status === 201, "放行后的历史缸具可新建批次", mk);
}

console.log("\n[I] 页面与接口一致");
{
  const res = await fetch(BASE + "/");
  const html = await res.text();
  ok(res.status === 200 && html.includes("缸具与清洗") && html.includes("审计日志"), "页面包含缸具清洗与审计页签");
  ok(html.includes("/api/cleaning-orders") && html.includes("/api/vats") && html.includes("swap-vat"), "页面调用与后端一致的接口");
  // 页面脚本执行回归：服务端模板不得吃掉客户端转义，脚本必须可解析执行
  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";
  let syntaxErr = "";
  try { new Function(script); } catch (e) { syntaxErr = e.message; }
  ok(script.length > 0 && !syntaxErr, "页面脚本语法可执行（无模板转义泄漏）", syntaxErr);
  ok(!html.includes("onclick='"), "事件绑定不使用会被模板吃掉转义的单引号属性");
  const cfg = await api("/api/config");
  ok(cfg.status === 200 && cfg.data.cleanRules.temperature.max === 100 && cfg.data.shifts.length === 3, "规则与班次通过接口下发");
}

await stop(server);
await rm(tmp, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
