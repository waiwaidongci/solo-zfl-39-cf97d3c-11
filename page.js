export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵记录 · 缸具清洗放行</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:18px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:16px; }
    main { padding:18px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; }
    input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; margin-top:10px; }
    button.secondary { background:#69736a; } button.danger { background:var(--warn); }
    .tabs { display:flex; gap:8px; } .tabs button { margin:0; background:#e4e9e1; color:var(--ink); } .tabs button.on { background:var(--accent); color:#fff; }
    .cols { display:grid; grid-template-columns:360px 1fr; gap:22px; align-items:start; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:150px; margin:0; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .warn { color:var(--warn); font-weight:700; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; margin-right:4px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; }
    .row { display:flex; gap:8px; align-items:center; } .row select,.row input { margin:0; } .row button { margin:0; white-space:nowrap; }
    #banner { display:none; margin:0 28px; padding:10px 14px; background:#f8e7e2; border:1px solid var(--warn); border-radius:8px; color:var(--warn); font-weight:700; }
    table { width:100%; border-collapse:collapse; background:#fff; } th,td { border:1px solid var(--line); padding:8px; font-size:13px; text-align:left; } th { background:#eef2ea; }
    .hidden { display:none; }
    @media (max-width:900px){ header{padding:14px 16px;} main{padding:14px 16px;} .cols{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header>
    <div><h1>古法纸浆发酵记录</h1><div class="meta">发酵批次 · 缸具清洗与复用放行闭环</div></div>
    <div class="tabs">
      <button data-tab="items" class="on">发酵批次</button>
      <button data-tab="cleaning">缸具与清洗</button>
      <button data-tab="audit">审计日志</button>
      <button id="reload" class="secondary" style="background:#69736a;color:#fff">刷新</button>
    </div>
  </header>
  <div id="banner"></div>
  <main>
    <section id="tab-items">
      <div class="cols">
        <div>
          <form id="createForm"><h2>新增纸浆批次</h2>
            <label>批次编号</label><input name="code" required>
            <label>原料来源</label><input name="source">
            <label>浸泡缸（仅已放行且空闲）</label><select name="vat" id="vatSelect" required></select>
            <label>发酵天数</label><input name="days" type="number" value="0">
            <label>负责人</label><input name="owner">
            <label>初始状态</label><select name="status" id="statusSelect"></select>
            <button>保存纸浆批次</button>
          </form>
          <form id="actionForm" style="margin-top:14px"><h2>每日观察记录</h2>
            <label>选择纸浆批次</label><select name="id" id="itemSelect"></select>
            <div id="extraFields"></div>
            <button>提交记录</button>
          </form>
        </div>
        <div>
          <div class="stats" id="stats"></div>
          <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option></select><input id="search" placeholder="搜索编号或关键词"></div>
          <div class="grid" id="cards"></div>
        </div>
      </div>
    </section>
    <section id="tab-cleaning" class="hidden">
      <div class="cols">
        <div>
          <form id="vatForm"><h2>缸具建档</h2>
            <label>缸具名称</label><input name="name" required placeholder="如：五号缸">
            <label>备注</label><input name="note" placeholder="容量、位置等">
            <button>建档</button>
          </form>
          <form id="dispatchForm" style="margin-top:14px"><h2>派出清洗工单</h2>
            <label>待清洗缸具</label><select id="dispatchVat"></select>
            <label>班次</label><select id="dispatchShift"></select>
            <label>派单人</label><input id="dispatchBy" placeholder="派单人姓名">
            <button>派单</button>
          </form>
          <form id="disForm" style="margin-top:14px"><h2>消毒剂批次登记</h2>
            <label>批次号</label><input name="batch" required placeholder="如 XD-2026-02">
            <label>名称</label><input name="name" required placeholder="如 次氯酸钠消毒剂">
            <label>有效期至</label><input name="expiresAt" type="date" required>
            <button>登记批次</button>
          </form>
          <div class="panel" style="margin-top:14px"><h2>消毒剂批次</h2><div id="disList"></div></div>
          <div class="panel" style="margin-top:14px"><h2>清洗判定规则</h2><div id="rules" class="meta"></div></div>
        </div>
        <div>
          <div class="stats" id="vatStats"></div>
          <div class="toolbar">
            <select id="fVat"><option value="">全部缸具</option></select>
            <select id="fShift"><option value="">全部班次</option></select>
            <select id="fReleased"><option value="">放行：全部</option><option value="released">已放行</option><option value="unreleased">未放行</option></select>
            <select id="fExpiry"><option value="">到期：全部</option><option value="expired">已到期</option><option value="expiring">临期</option><option value="valid">未到期</option></select>
          </div>
          <div class="panel" style="margin-bottom:14px"><h2>缸具台账</h2><div class="grid" id="vatCards"></div></div>
          <div class="panel"><h2>清洗工单（领单 → 参数登记 → 复检 → 放行 → 到期失效）</h2><div class="grid" id="orderCards"></div></div>
        </div>
      </div>
    </section>
    <section id="tab-audit" class="hidden">
      <div class="panel"><h2>审计日志（失败操作不写入）</h2><div id="auditTable"></div></div>
    </section>
  </main>
  <script>
    var S = { items: [], vats: [], orders: [], disinfectants: [], audit: [], config: null };
    var STAGES = ["入缸","发酵中","可抄纸","异常观察"];
    var EXTRA = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"],["abnormal","异味或霉点"]];
    var ACTION_LABELS = { vat_register:"缸具建档", order_dispatch:"派单", order_claim:"领单", cleaning_submit:"参数登记", order_rejected:"整单拒绝", recheck_pass:"复检通过", recheck_fail:"复检不通过", order_release:"放行", vat_expired:"到期失效", vat_quarantine:"隔离", vat_unquarantine:"解除隔离", item_create:"批次占用", item_swap_vat:"换缸", vat_vacated:"批次换出", disinfectant_add:"消毒剂登记", migrate_pending_recheck:"迁移待补检" };
    var PILL_COLORS = { dirty:"#8a6d3b", cleaning:"#2f6f8f", recheck:"#2f6f8f", pending_release:"#6a5aa0", released:"#3f7a3f", expired:"#9b4937", pending_recheck:"#8a6d3b", quarantined:"#333", dispatched:"#2f6f8f", claimed:"#2f6f8f", rechecked:"#6a5aa0", rejected:"#9b4937" };
    function $(s){ return document.querySelector(s); }
    function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]; }); }
    function fmt(iso){ if(!iso) return "—"; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString("zh-CN", { hour12:false }); }
    function leftText(ms){ if(ms==null) return ""; if(ms<=0) return "已到期"; var h = Math.floor(ms/3600e3), m = Math.round(ms%3600e3/6e4); return "剩余 " + h + "小时" + m + "分"; }
    function pill(label, key){ var c = PILL_COLORS[key] || "#687066"; return '<span class="pill" style="color:#fff;background:' + c + ';border-color:' + c + '">' + esc(label) + "</span>"; }
    function showErr(msg){ var b = $("#banner"); b.textContent = msg; b.style.display = "block"; clearTimeout(showErr.t); showErr.t = setTimeout(function(){ b.style.display = "none"; }, 8000); }
    function run(p){ Promise.resolve(p).catch(function(e){ showErr(e.message || String(e)); }); }
    async function api(path, options){
      var opts = options || {};
      if (opts.body) opts = Object.assign({}, opts, { headers: { "Content-Type": "application/json" } });
      var res = await fetch(path, opts);
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.message || data.error || ("请求失败 " + res.status));
      return data;
    }
    function loadAll(){
      return Promise.all([api("/api/config"), api("/api/items"), api("/api/vats"), api("/api/cleaning-orders"), api("/api/disinfectants"), api("/api/audit")])
        .then(function(r){ S.config = r[0]; S.items = r[1]; S.vats = r[2]; S.orders = r[3]; S.disinfectants = r[4]; S.audit = r[5]; renderAll(); });
    }
    function usableVats(){ return S.vats.filter(function(v){ return v.status === "released" && !v.occupiedBy; }); }
    function arg(s){ return "decodeURIComponent('" + encodeURIComponent(s) + "')"; }

    // ===== 发酵批次页签 =====
    function renderItemsTab(){
      var stats = {}; STAGES.forEach(function(s){ stats[s] = 0; });
      S.items.forEach(function(i){ if (stats[i.status] != null) stats[i.status]++; });
      $("#stats").innerHTML = Object.keys(stats).map(function(k){ return '<div class="stat"><span>' + k + "</span><strong>" + stats[k] + "</strong></div>"; }).join("");
      $("#itemSelect").innerHTML = S.items.map(function(i){ return '<option value="' + esc(i.id || i.code) + '">' + esc(i.code || i.id) + " · " + esc(i.source || "") + "</option>"; }).join("");
      var usable = usableVats();
      $("#vatSelect").innerHTML = usable.length
        ? usable.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc(v.name) + "（放行有效至 " + fmt(v.release.validUntil) + "）</option>"; }).join("")
        : '<option value="">暂无已放行且空闲的缸具</option>';
      var sf = $("#statusFilter");
      if (!sf.options.length || sf.dataset.init !== "1") { sf.innerHTML = '<option value="">全部状态</option>' + STAGES.map(function(s){ return "<option>" + s + "</option>"; }).join(""); sf.dataset.init = "1"; }
      $("#statusSelect").innerHTML = STAGES.map(function(s){ return "<option>" + s + "</option>"; }).join("");
      var status = sf.value, q = $("#search").value.trim();
      var visible = S.items.filter(function(i){ return (!status || i.status === status) && (!q || JSON.stringify(i).indexOf(q) >= 0); });
      $("#cards").innerHTML = visible.map(itemCard).join("") || '<div class="panel meta">暂无批次</div>';
    }
    function itemCard(item){
      var id = item.id || item.code;
      var h = "<h3>" + esc(item.code || item.id) + "</h3>" + pill(item.status, item.status);
      h += "<div><b>原料来源</b> " + esc(item.source || "") + "</div>";
      h += "<div><b>浸泡缸</b> " + esc(item.vat || "") + (item.vatStatusLabel ? " " + pill(item.vatStatusLabel, item.vatStatus) : "") + "</div>";
      h += "<div><b>发酵天数</b> " + esc(item.days) + " · <b>负责人</b> " + esc(item.owner || "") + "</div>";
      var swapOpts = usableVats().filter(function(v){ return v.id !== item.vatId; });
      if (swapOpts.length) {
        h += '<div class="row"><select id="swap-' + esc(id) + '">' + swapOpts.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>"; }).join("") + '</select><button class="secondary" onclick="swapVat(' + arg(id) + ')">换缸</button></div>';
      } else {
        h += '<div class="meta">无可换入的已放行缸具</div>';
      }
      h += '<div class="row"><select id="st-' + esc(id) + '">' + STAGES.map(function(s){ return "<option " + (s === item.status ? "selected" : "") + ">" + s + "</option>"; }).join("") + '</select><button class="secondary" onclick="changeStatus(' + arg(id) + ')">改状态</button></div>';
      h += '<button class="secondary" onclick="addNote(' + arg(id) + ')">追加备注</button>';
      var logs = (item.logs || []).slice(-4).map(function(l){ return "<div>" + esc(l.step) + "：" + esc(l.note) + "</div>"; }).join("");
      h += '<div class="logs meta">' + (logs || "暂无记录") + "</div>";
      return '<article class="card">' + h + "</article>";
    }
    function changeStatus(id){ run(api("/api/items/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status: $("#st-" + CSS.escape(id)).value }) }).then(loadAll)); }
    function addNote(id){ var note = prompt("记录备注"); if (note) run(api("/api/items/" + encodeURIComponent(id) + "/logs", { method: "POST", body: JSON.stringify({ step: "备注", note: note }) }).then(loadAll)); }
    function swapVat(id){
      var sel = $("#swap-" + CSS.escape(id));
      if (!sel || !sel.value) return showErr("没有可换入的缸具");
      run(api("/api/items/" + encodeURIComponent(id) + "/swap-vat", { method: "POST", body: JSON.stringify({ vat: sel.value }) }).then(loadAll));
    }

    // ===== 缸具与清洗页签 =====
    function renderCleaningTab(){
      var counts = {};
      S.vats.forEach(function(v){ counts[v.status] = (counts[v.status] || 0) + 1; });
      $("#vatStats").innerHTML = Object.keys(S.config.vatStatusLabels).map(function(k){
        return '<div class="stat"><span>' + esc(S.config.vatStatusLabels[k]) + "</span><strong>" + (counts[k] || 0) + "</strong></div>";
      }).join("");
      var dispatchable = S.vats.filter(function(v){ return v.dispatchable; });
      $("#dispatchVat").innerHTML = dispatchable.length ? dispatchable.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc(v.name) + "（" + esc(v.statusLabel) + "）</option>"; }).join("") : '<option value="">暂无可派单缸具</option>';
      $("#dispatchShift").innerHTML = S.config.shifts.map(function(s){ return "<option>" + s + "</option>"; }).join("");
      var fv = $("#fVat"); var keepVat = fv.value;
      fv.innerHTML = '<option value="">全部缸具</option>' + S.vats.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>"; }).join("");
      fv.value = keepVat;
      var fs = $("#fShift");
      if (fs.dataset.init !== "1") { fs.innerHTML = '<option value="">全部班次</option>' + S.config.shifts.map(function(s){ return "<option>" + s + "</option>"; }).join(""); fs.dataset.init = "1"; }
      $("#fExpiry").options[2].text = "临期(" + S.config.expiringSoonHours + "h内)";
      $("#disList").innerHTML = S.disinfectants.map(function(d){
        return '<div class="meta">' + esc(d.batch) + " · " + esc(d.name) + " · 有效期至 " + esc(d.expiresAt) + (d.expired ? ' <span class="warn">已过期</span>' : "") + "</div>";
      }).join("") || '<div class="meta">暂无批次</div>';
      var r = S.config.cleanRules;
      $("#rules").innerHTML = "温度 " + r.temperature.min + "–" + r.temperature.max + r.temperature.unit + "；浓度 " + r.concentration.min + "–" + r.concentration.max + r.concentration.unit + "；时长 " + r.durationMinutes.min + "–" + r.durationMinutes.max + r.durationMinutes.unit + "；操作人、消毒剂批次必填；越界或批次过期整单拒绝；复检人不得与操作人相同；默认放行有效期 " + S.config.defaultValidHours + " 小时。";
      $("#vatCards").innerHTML = S.vats.map(vatCard).join("") || '<div class="meta">暂无缸具</div>';
      $("#orderCards").innerHTML = S.orders.filter(orderVisible).map(orderCard).join("") || '<div class="meta">暂无工单</div>';
    }
    function vatCard(v){
      var h = "<h3>" + esc(v.name) + "</h3>" + pill(v.statusLabel, v.status);
      h += '<div class="meta">占用：' + (v.occupiedBy ? esc(v.occupiedBy) : "空闲") + "</div>";
      if (v.release) h += '<div class="meta">放行有效至 ' + fmt(v.release.validUntil) + "（" + leftText(v.releaseMsLeft) + "）" + (v.expiringSoon ? ' <span class="warn">临期</span>' : "") + "</div>";
      if (v.status === "expired") h += '<div class="warn">已失效：' + fmt(v.expiredAt) + "</div>";
      if (v.activeOrder) h += '<div class="meta">当前工单 ' + esc(v.activeOrder.id) + " · " + esc(v.activeOrder.statusLabel) + " · " + esc(v.activeOrder.shift) + "</div>";
      if (v.note) h += '<div class="meta">' + esc(v.note) + "</div>";
      if (v.dispatchable) {
        h += '<div class="row"><select id="shift-' + esc(v.id) + '">' + S.config.shifts.map(function(s){ return "<option>" + s + "</option>"; }).join("") + '</select><button onclick="dispatchOrder(' + arg(v.id) + ')">派单</button></div>';
      }
      if (v.status === "quarantined") {
        h += '<button class="secondary" onclick="unquarantineVat(' + arg(v.id) + ')">解除隔离</button>';
      } else if (!v.occupiedBy && !v.activeOrder) {
        h += '<button class="danger" onclick="quarantineVat(' + arg(v.id) + ')">隔离</button>';
      }
      return '<article class="card">' + h + "</article>";
    }
    function orderVisible(o){
      var fv = $("#fVat").value; if (fv && o.vatId !== fv) return false;
      var fs = $("#fShift").value; if (fs && o.shift !== fs) return false;
      var fr = $("#fReleased").value;
      if (fr === "released" && o.status !== "released") return false;
      if (fr === "unreleased" && o.status === "released") return false;
      var fe = $("#fExpiry").value;
      if (fe) {
        var left = o.release ? Date.parse(o.release.validUntil) - Date.now() : null;
        if (fe === "expired" && o.status !== "expired") return false;
        if (fe === "expiring" && !(o.status === "released" && left !== null && left <= S.config.expiringSoonHours * 3600e3)) return false;
        if (fe === "valid" && !(o.status === "released" && left > S.config.expiringSoonHours * 3600e3)) return false;
      }
      return true;
    }
    function orderCard(o){
      var h = "<h3>" + esc(o.id) + " · " + esc(o.vatName) + "</h3>" + pill(o.statusLabel, o.status) + '<span class="pill">' + esc(o.shift) + "</span>";
      h += '<div class="meta">派单 ' + esc(o.dispatchedBy || "") + " " + fmt(o.dispatchedAt) + "</div>";
      if (o.claimedBy) h += '<div class="meta">领单 ' + esc(o.claimedBy) + " " + fmt(o.claimedAt) + "</div>";
      if (o.cleaning) h += '<div class="meta">清洗 温度' + o.cleaning.temperature + "℃ 浓度" + o.cleaning.concentration + "% 时长" + o.cleaning.durationMinutes + "分钟 · 操作人 " + esc(o.cleaning.operator) + " · 批次 " + esc(o.cleaning.disinfectantBatch) + "</div>";
      if (o.recheck) h += '<div class="meta">复检 ' + esc(o.recheck.inspector) + " " + (o.recheck.result === "pass" ? "通过" : "不通过") + " " + fmt(o.recheck.at) + (o.recheck.note ? " · " + esc(o.recheck.note) : "") + "</div>";
      if (o.release) h += '<div class="meta">放行 ' + esc(o.release.releasedBy) + " 有效至 " + fmt(o.release.validUntil) + "</div>";
      if (o.status === "rejected") h += '<div class="warn">整单拒绝：' + esc(o.rejectedReason || "") + "</div>";
      if (o.status === "expired") h += '<div class="warn">已失效：' + fmt(o.expiredAt) + "</div>";
      h += orderAction(o);
      return '<article class="card">' + h + "</article>";
    }
    function orderAction(o){
      var id = o.id;
      if (o.status === "dispatched") {
        return '<label>操作人</label><input id="op-' + esc(id) + '" placeholder="领单人姓名"><button onclick="claimOrder(' + arg(id) + ')">领单</button>';
      }
      if (o.status === "claimed") {
        var opts = S.disinfectants.map(function(d){ return '<option value="' + esc(d.batch) + '"' + (d.expired ? " disabled" : "") + ">" + esc(d.batch) + " · " + esc(d.name) + (d.expired ? "（已过期）" : "") + "</option>"; }).join("");
        return '<label>温度（℃）</label><input id="tp-' + esc(id) + '" type="number" step="0.1">'
          + '<label>浓度（%）</label><input id="cc-' + esc(id) + '" type="number" step="0.1">'
          + '<label>时长（分钟）</label><input id="du-' + esc(id) + '" type="number">'
          + '<label>操作人</label><input id="op2-' + esc(id) + '" value="' + esc(o.claimedBy || "") + '">'
          + '<label>消毒剂批次</label><select id="db-' + esc(id) + '">' + opts + "</select>"
          + '<button onclick="submitCleaning(' + arg(id) + ')">提交清洗参数</button>';
      }
      if (o.status === "recheck") {
        return '<label>复检人（不得与操作人相同）</label><input id="ri-' + esc(id) + '">'
          + '<label>复检结果</label><select id="rr-' + esc(id) + '"><option value="pass">通过</option><option value="fail">不通过</option></select>'
          + '<label>复检备注</label><input id="rn-' + esc(id) + '">'
          + '<button onclick="submitRecheck(' + arg(id) + ')">提交复检</button>';
      }
      if (o.status === "rechecked") {
        return '<label>放行人</label><input id="rb-' + esc(id) + '">'
          + '<label>有效期（小时，默认' + S.config.defaultValidHours + '）</label><input id="vh-' + esc(id) + '" type="number" step="0.1" placeholder="' + S.config.defaultValidHours + '">'
          + '<button onclick="releaseOrder(' + arg(id) + ')">放行</button>';
      }
      return "";
    }
    function dispatchOrder(vatId){
      var shift = $("#shift-" + CSS.escape(vatId)) ? $("#shift-" + CSS.escape(vatId)).value : $("#dispatchShift").value;
      run(api("/api/cleaning-orders", { method: "POST", body: JSON.stringify({ vatId: vatId, shift: shift, dispatchedBy: $("#dispatchBy").value || "台账员" }) }).then(loadAll));
    }
    function dispatchFromForm(){
      var vatId = $("#dispatchVat").value;
      if (!vatId) return showErr("暂无可派单的缸具");
      run(api("/api/cleaning-orders", { method: "POST", body: JSON.stringify({ vatId: vatId, shift: $("#dispatchShift").value, dispatchedBy: $("#dispatchBy").value || "台账员" }) }).then(loadAll));
    }
    function claimOrder(id){ run(api("/api/cleaning-orders/" + id + "/claim", { method: "POST", body: JSON.stringify({ operator: $("#op-" + CSS.escape(id)).value }) }).then(loadAll)); }
    function submitCleaning(id){
      var g = function(p){ return $("#" + p + "-" + CSS.escape(id)).value; };
      run(api("/api/cleaning-orders/" + id + "/cleaning", { method: "POST", body: JSON.stringify({ temperature: g("tp"), concentration: g("cc"), durationMinutes: g("du"), operator: g("op2"), disinfectantBatch: g("db") }) }).then(loadAll));
    }
    function submitRecheck(id){
      var g = function(p){ return $("#" + p + "-" + CSS.escape(id)).value; };
      run(api("/api/cleaning-orders/" + id + "/recheck", { method: "POST", body: JSON.stringify({ inspector: g("ri"), result: g("rr"), note: g("rn") }) }).then(loadAll));
    }
    function releaseOrder(id){
      var g = function(p){ return $("#" + p + "-" + CSS.escape(id)).value; };
      run(api("/api/cleaning-orders/" + id + "/release", { method: "POST", body: JSON.stringify({ releasedBy: g("rb"), validHours: g("vh") }) }).then(loadAll));
    }
    function quarantineVat(id){ var reason = prompt("隔离原因") || ""; run(api("/api/vats/" + encodeURIComponent(id) + "/quarantine", { method: "POST", body: JSON.stringify({ reason: reason }) }).then(loadAll)); }
    function unquarantineVat(id){ run(api("/api/vats/" + encodeURIComponent(id) + "/unquarantine", { method: "POST", body: "{}" }).then(loadAll)); }

    // ===== 审计页签 =====
    function renderAuditTab(){
      var vatName = {};
      S.vats.forEach(function(v){ vatName[v.id] = v.name; });
      var rows = S.audit.map(function(a){
        return "<tr><td>" + fmt(a.at) + "</td><td>" + esc(a.actor) + "</td><td>" + esc(ACTION_LABELS[a.action] || a.action) + "</td><td>" + esc(vatName[a.vatId] || a.vatId || "") + "</td><td>" + esc(a.orderId || "") + "</td><td>" + esc(a.detail) + "</td></tr>";
      }).join("");
      $("#auditTable").innerHTML = rows ? "<table><tr><th>时间</th><th>操作人</th><th>动作</th><th>缸具</th><th>工单</th><th>详情</th></tr>" + rows + "</table>" : '<div class="meta">暂无审计记录</div>';
    }

    function renderAll(){ renderItemsTab(); renderCleaningTab(); renderAuditTab(); }

    // ===== 事件绑定 =====
    document.querySelectorAll(".tabs button[data-tab]").forEach(function(btn){
      btn.onclick = function(){
        document.querySelectorAll(".tabs button[data-tab]").forEach(function(b){ b.classList.remove("on"); });
        btn.classList.add("on");
        ["items", "cleaning", "audit"].forEach(function(t){ $("#tab-" + t).classList.toggle("hidden", t !== btn.dataset.tab); });
      };
    });
    $("#createForm").onsubmit = function(e){ e.preventDefault(); var f = e.target; run(api("/api/items", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(f).entries())) }).then(function(){ f.reset(); return loadAll(); })); };
    $("#actionForm").onsubmit = function(e){ e.preventDefault(); var f = e.target; var data = Object.fromEntries(new FormData(f).entries()); var id = data.id; delete data.id; run(api("/api/items/" + encodeURIComponent(id) + "/action", { method: "POST", body: JSON.stringify(data) }).then(function(){ f.reset(); return loadAll(); })); };
    $("#vatForm").onsubmit = function(e){ e.preventDefault(); var f = e.target; run(api("/api/vats", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(f).entries())) }).then(function(){ f.reset(); return loadAll(); })); };
    $("#disForm").onsubmit = function(e){ e.preventDefault(); var f = e.target; run(api("/api/disinfectants", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(f).entries())) }).then(function(){ f.reset(); return loadAll(); })); };
    $("#dispatchForm").onsubmit = function(e){ e.preventDefault(); dispatchFromForm(); };
    $("#statusFilter").onchange = renderItemsTab; $("#search").oninput = renderItemsTab;
    ["fVat", "fShift", "fReleased", "fExpiry"].forEach(function(id){ $("#" + id).onchange = renderCleaningTab; });
    $("#reload").onclick = function(){ run(loadAll()); };
    $("#extraFields").innerHTML = EXTRA.map(function(x){ return "<label>" + x[1] + '</label><input name="' + x[0] + '">'; }).join("");
    run(loadAll());
  </script>
</body>
</html>`;
}
