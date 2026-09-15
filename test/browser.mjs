// 真实浏览器（Chromium）页面走通回归
// 覆盖：页签切换、建档、派单、领单、清洗（越界422提示与回滚）、复检（同人拦截）、
//       放行、新建批次、换缸、到期拦截、筛选、审计展示，全程零控制台错误
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 3221;
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

const tmp = await mkdtemp(join(tmpdir(), "ferment-ui-"));
const dbPath = join(tmp, "db.json");
await writeFile(dbPath, JSON.stringify({
  items: [{ code: "PF-OLD", source: "构树皮", vat: "老缸", days: 3, owner: "林素", status: "发酵中", logs: [] }],
}));

const server = spawn(process.execPath, [join(root, "server.js")], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath },
  stdio: ["ignore", "ignore", "inherit"],
});
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(BASE + "/api/items");
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  server.kill("SIGTERM");
  await rm(tmp, { recursive: true, force: true });
  throw e;
}
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // 本页只加载 HTML 与 /api/*：4xx 业务拒绝（越界422、同人400、冲突409）会被浏览器记为资源错误，属预期噪音；5xx 仍视为缺陷
  if (/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
  errors.push("console: " + m.text());
});
// 请求计数：验证留空/取消时不发请求
let notePosts = 0;
let quarantinePosts = 0;
page.on("request", (r) => {
  if (r.method() !== "POST") return;
  if (/\/api\/items\/[^/]+\/logs/.test(r.url())) notePosts++;
  if (/\/api\/vats\/[^/]+\/quarantine/.test(r.url())) quarantinePosts++;
});

const vatCard = (name) => page.locator("#vatCards .card", { hasText: name });
const orderCard = (name) => page.locator("#orderCards .card", { hasText: name });
const orderCount = () => page.locator("#orderCards .card").count();
async function switchTab(tab) {
  await page.click(`.tabs button[data-tab="${tab}"]`);
  await page.waitForSelector(`#tab-${tab}:visible`);
}
async function bannerShows(text) {
  await page.waitForFunction((t) => {
    const b = document.querySelector("#banner");
    return b && b.style.display !== "none" && b.textContent.includes(t);
  }, text);
}

// 建档 → 派单 → 领单 → 清洗 → 复检 → 放行（全部通过页面表单）
async function cleanFlow(name, { validHours, deepChecks = false, useDispatchForm = false } = {}) {
  await page.fill('#vatForm input[name="name"]', name);
  await page.fill('#vatForm input[name="note"]', "浏览器走通");
  await page.click("#vatForm button");
  await vatCard(name).waitFor();
  if (useDispatchForm) {
    const val = await page.$$eval("#dispatchVat option", (os, n) => (os.find((o) => o.textContent.includes(n)) || {}).value, name);
    await page.selectOption("#dispatchVat", val);
    await page.selectOption("#dispatchShift", "早班");
    await page.fill("#dispatchBy", "王班长");
    await page.click("#dispatchForm button");
  } else {
    await vatCard(name).locator("select").selectOption("早班");
    await vatCard(name).locator("button", { hasText: "派单" }).click();
  }
  const oc = orderCard(name);
  await oc.locator(".pill", { hasText: "已派单" }).waitFor();
  await oc.locator('input[placeholder="领单人姓名"]').fill("张三");
  await oc.locator("button", { hasText: "领单" }).click();
  await oc.locator(".pill", { hasText: "已领单" }).waitFor();
  if (deepChecks) {
    // 越界提交 → 页面提示整单拒绝，工单保持已领单（422 完全回滚）
    await oc.locator("input").nth(0).fill("30");
    await oc.locator("input").nth(1).fill("2.5");
    await oc.locator("input").nth(2).fill("40");
    await oc.locator("button", { hasText: "提交清洗参数" }).click();
    await bannerShows("整单拒绝");
    ok(await oc.locator(".pill", { hasText: "已领单" }).isVisible(), "越界422后页面提示且工单保持已领单");
  }
  await oc.locator("input").nth(0).fill("85");
  await oc.locator("input").nth(1).fill("2.5");
  await oc.locator("input").nth(2).fill("40");
  await oc.locator("button", { hasText: "提交清洗参数" }).click();
  await oc.locator(".pill", { hasText: "待复检" }).waitFor();
  if (deepChecks) {
    await oc.locator("input").nth(0).fill("张三");
    await oc.locator("button", { hasText: "提交复检" }).click();
    await bannerShows("复检人不能与操作人相同");
    ok(true, "复检人=操作人页面提示拒绝");
  }
  await oc.locator("input").nth(0).fill("李四");
  await oc.locator("button", { hasText: "提交复检" }).click();
  await oc.locator(".pill", { hasText: "待放行" }).waitFor();
  await oc.locator("input").nth(0).fill("王班长");
  if (validHours) await oc.locator("input").nth(1).fill(validHours);
  await oc.locator("button", { hasText: "放行" }).click();
  await oc.locator(".pill", { hasText: "已放行" }).waitFor();
  await vatCard(name).locator(".pill", { hasText: "已放行" }).waitFor();
}

try {
  console.log("\n[UI-1] 页面加载与页签切换");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await switchTab("cleaning");
  ok(await page.locator('#vatForm input[name="name"]').isVisible(), "缸具与清洗页签可切换，建档输入可见");
  ok(await page.locator("#dispatchVat").isVisible(), "派单输入可见");
  ok(await page.locator("#fVat").isVisible() && (await page.locator("#fExpiry").isVisible()), "筛选控件可见");
  ok(await vatCard("老缸").locator(".pill", { hasText: "待补检" }).isVisible(), "历史缸具显示待补检");

  console.log("\n[UI-2] 建档 → 派单 → 领单 → 清洗 → 复检 → 放行（页面表单）");
  await cleanFlow("UI一号缸", { deepChecks: true });
  ok(true, "UI一号缸 全流程走通（含越界与同人拦截提示）");
  await cleanFlow("UI二号缸", { useDispatchForm: true });
  ok(true, "UI二号缸 全流程走通（派单表单）");
  await cleanFlow("UI三号缸", { validHours: "0.0003" });
  ok(true, "UI三号缸 短有效期放行成功");

  console.log("\n[UI-3] 新建批次与换缸");
  await switchTab("items");
  const vatOpts = await page.$$eval("#vatSelect option", (os) => os.map((o) => o.textContent));
  ok(vatOpts.some((t) => t.includes("UI一号缸")), "已放行缸具出现在新建批次下拉", vatOpts);
  await page.fill('#createForm input[name="code"]', "PF-UI1");
  await page.fill('#createForm input[name="source"]', "桑皮");
  const v1 = await page.$$eval("#vatSelect option", (os) => (os.find((o) => o.textContent.includes("UI一号缸")) || {}).value);
  await page.selectOption("#vatSelect", v1);
  await page.fill('#createForm input[name="owner"]', "林素");
  await page.click("#createForm button");
  const item = page.locator("#cards .card", { hasText: "PF-UI1" });
  await item.waitFor();
  ok(await item.locator("text=浸泡缸 UI一号缸").isVisible(), "页面新建批次成功");
  await item.locator("select").nth(0).selectOption({ label: "UI二号缸" });
  await item.locator("button", { hasText: "换缸" }).click();
  await item.locator("text=浸泡缸 UI二号缸").waitFor();
  ok(true, "页面换缸成功（UI一号缸 → UI二号缸）");

  console.log("\n[UI-4] 到期拦截");
  await page.waitForTimeout(1700);
  await switchTab("cleaning");
  await page.click("#reload");
  await vatCard("UI三号缸").locator(".pill", { hasText: "已失效" }).waitFor();
  await orderCard("UI三号缸").locator(".pill", { hasText: "已失效" }).waitFor();
  ok(true, "到期后缸具与工单页面显示已失效");
  await switchTab("items");
  const opts2 = await page.$$eval("#vatSelect option", (os) => os.map((o) => o.textContent));
  ok(!opts2.some((t) => t.includes("UI三号缸")), "已失效缸具不出现在新建批次下拉", opts2);
  const blocked = await page.evaluate(async (base) => {
    const r = await fetch(base + "/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "PF-UI9", vat: "UI三号缸" }) });
    return r.status;
  }, BASE);
  ok(blocked === 409, "已失效缸具新建批次被接口拦截", blocked);

  console.log("\n[UI-5] 筛选（缸具/班次/放行/到期）");
  await switchTab("cleaning");
  await page.selectOption("#fVat", { label: "UI一号缸" });
  ok((await orderCount()) === 1, "按缸具筛选", await orderCount());
  await page.selectOption("#fVat", "");
  await page.selectOption("#fShift", "早班");
  ok((await orderCount()) === 3, "按班次筛选（早班3单）", await orderCount());
  await page.selectOption("#fShift", "中班");
  ok((await orderCount()) === 0, "按班次筛选（中班0单）", await orderCount());
  await page.selectOption("#fShift", "");
  await page.selectOption("#fReleased", "released");
  ok((await orderCount()) === 2, "筛选已放行", await orderCount());
  await page.selectOption("#fReleased", "unreleased");
  ok((await orderCount()) === 1, "筛选未放行", await orderCount());
  await page.selectOption("#fReleased", "");
  await page.selectOption("#fExpiry", "expired");
  ok((await orderCount()) === 1, "筛选已到期", await orderCount());
  await page.selectOption("#fExpiry", "valid");
  ok((await orderCount()) === 2, "筛选未到期", await orderCount());
  await page.selectOption("#fExpiry", "");

  console.log("\n[UI-6] 备注与隔离入口（填写/留空/取消）");
  await switchTab("items");
  const card = page.locator("#cards .card", { hasText: "PF-UI1" });
  await card.locator("button", { hasText: /^追加备注$/ }).click();
  ok(await card.locator('[id^="notebox-"]').isVisible(), "备注输入框在页面内展开");
  const noteBefore = notePosts;
  await card.locator("button", { hasText: /^提交备注$/ }).click();
  await bannerShows("未提交");
  ok(notePosts === noteBefore, "备注留空：页面提示且不发请求", notePosts);
  await card.locator('[id^="note-"]').fill("这条不应提交");
  await card.locator("button", { hasText: /^取消$/ }).click();
  await bannerShows("已取消");
  ok(notePosts === noteBefore && !(await card.locator('[id^="notebox-"]').isVisible()), "备注取消：提示、收起且不发请求", notePosts);
  await card.locator("button", { hasText: /^追加备注$/ }).click();
  await card.locator('[id^="note-"]').fill("浏览器备注：纤维松散良好");
  await card.locator("button", { hasText: /^提交备注$/ }).click();
  await card.locator("text=浏览器备注：纤维松散良好").waitFor();
  ok(notePosts === noteBefore + 1, "备注填写：提交成功并刷新展示", notePosts);

  await switchTab("cleaning");
  const vc = vatCard("UI一号缸");
  await vc.locator("button", { hasText: /^隔离$/ }).click();
  ok(await vc.locator('[id^="qbox-"]').isVisible(), "隔离原因输入框在页面内展开");
  const qBefore = quarantinePosts;
  await vc.locator("button", { hasText: /^确认隔离$/ }).click();
  await bannerShows("未提交");
  ok(quarantinePosts === qBefore, "隔离留空：页面提示且不发请求", quarantinePosts);
  await vc.locator('[id^="qreason-"]').fill("这条不应提交");
  await vc.locator("button", { hasText: /^取消$/ }).click();
  await bannerShows("已取消");
  ok(quarantinePosts === qBefore && !(await vc.locator('[id^="qbox-"]').isVisible()), "隔离取消：提示、收起且不发请求", quarantinePosts);
  await vc.locator("button", { hasText: /^隔离$/ }).click();
  await vc.locator('[id^="qreason-"]').fill("缸壁裂纹");
  await vc.locator("button", { hasText: /^确认隔离$/ }).click();
  await vc.locator(".pill", { hasText: "已隔离" }).waitFor();
  ok(quarantinePosts === qBefore + 1, "隔离填写：提交成功，缸具状态刷新为已隔离", quarantinePosts);
  await vc.locator("button", { hasText: /^解除隔离$/ }).click();
  await vc.locator(".pill", { hasText: "待清洗" }).waitFor();
  ok(true, "解除隔离恢复待清洗");

  console.log("\n[UI-7] 审计页签");
  await switchTab("audit");
  await page.locator("#auditTable table").waitFor();
  const auditText = await page.locator("#auditTable").textContent();
  ok(auditText.includes("派单") && auditText.includes("领单") && auditText.includes("放行") && auditText.includes("换缸") && auditText.includes("隔离"), "审计日志展示闭环动作");
  ok(!auditText.includes("整单拒绝"), "422回滚后审计无拒绝记录", undefined);

  console.log("\n[UI-8] 控制台错误");
  ok(errors.length === 0, "全程无浏览器控制台错误", errors);
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await rm(tmp, { recursive: true, force: true });
}
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
