// Lantern — interactive pieces: theme, command palette, watchlist & alerts, hero plate,
// heatmap, exchange timeline and the calculators on the Tools page.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n, d = 2) => (!isFinite(n) ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (n) => (!isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
  const num = (el) => { const v = parseFloat(String(el.value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };

  function fit(c) {
    const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  // ───────────── theme ─────────────
  function initTheme() {
    const saved = ls.get("ln-theme", null);
    if (saved) document.documentElement.dataset.theme = saved;
    const btn = $("#theme");
    if (!btn) return;
    btn.onclick = () => {
      const dark = document.documentElement.dataset.theme !== "light";
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      ls.set("ln-theme", next);
      document.dispatchEvent(new Event("ln:theme"));
    };
  }

  // ───────────── watchlist & alerts ─────────────
  const watch = {
    list() { return ls.get("ln-watch", []); },
    has(sym) { return this.list().includes(sym); },
    toggle(sym) { const l = this.list(); const i = l.indexOf(sym); if (i >= 0) l.splice(i, 1); else l.push(sym); ls.set("ln-watch", l); return i < 0; },
  };
  const alerts = {
    list() { return ls.get("ln-alerts", []); },
    add(a) { const l = this.list(); l.push({ ...a, id: Date.now() + Math.random() }); ls.set("ln-alerts", l); },
    remove(id) { ls.set("ln-alerts", this.list().filter((a) => a.id !== id)); },
    // returns alerts that fired, and removes them
    check(markets) {
      const fired = [];
      const keep = this.list().filter((a) => {
        const m = markets.find((x) => x.symbol === a.symbol);
        if (!m) return true;
        const p = Number(m.price) / 1e8;
        const hit = a.dir === "above" ? p >= a.price : p <= a.price;
        if (hit) fired.push({ ...a, now: p });
        return !hit;
      });
      if (fired.length) ls.set("ln-alerts", keep);
      return fired;
    },
  };

  // ───────────── command palette ─────────────
  function initPalette(getMarkets) {
    const items = () => [
      ...getMarkets().map((m) => ({ label: `${m.symbol} · ${m.name}`, hint: "Trade", href: `#/trade/${m.symbol}` })),
      { label: "Markets", hint: "Page", href: "#/markets" }, { label: "Portfolio", hint: "Page", href: "#/portfolio" },
      { label: "Vault", hint: "Page", href: "#/vault" }, { label: "Tools: calculators & timeline", hint: "Page", href: "#/tools" },
      { label: "How it works", hint: "Page", href: "#/learn" }, { label: "Risk disclosure", hint: "Page", href: "#/risk" },
      { label: "Switch theme", hint: "Action", run: () => $("#theme")?.click() },
    ];
    let box = null, sel = 0, shown = [];
    function close() { box?.remove(); box = null; }
    function render(q) {
      const s = q.toLowerCase().trim();
      shown = items().filter((i) => !s || i.label.toLowerCase().includes(s)).slice(0, 9);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      $("ul", box).innerHTML = shown.length ? shown.map((i, k) => `<li class="${k === sel ? "on" : ""}" data-k="${k}"><span>${esc(i.label)}</span><small>${i.hint}</small></li>`).join("") : `<li><span class="faint">No matches</span></li>`;
      $$("li[data-k]", box).forEach((li) => { li.onclick = () => go(Number(li.dataset.k)); li.onmousemove = () => { if (sel !== Number(li.dataset.k)) { sel = Number(li.dataset.k); render($("input", box).value); } }; });
    }
    function go(k) { const i = shown[k]; if (!i) return; close(); if (i.run) i.run(); else location.hash = i.href; }
    function open() {
      if (box) return;
      box = document.createElement("div");
      box.className = "cmdk";
      box.innerHTML = `<div class="cmdk__box" role="dialog" aria-label="Command palette"><input id="cmdkInput" placeholder="Search markets and pages…" autocomplete="off" aria-label="Search"><ul></ul></div>`;
      document.body.appendChild(box);
      sel = 0; render("");
      const inp = $("input", box); inp.focus();
      inp.oninput = () => { sel = 0; render(inp.value); };
      inp.onkeydown = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(inp.value); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(inp.value); }
        else if (e.key === "Enter") { e.preventDefault(); go(sel); }
        else if (e.key === "Escape") close();
      };
      box.addEventListener("click", (e) => { if (e.target === box) close(); });
    }
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box ? close() : open(); }
      else if (e.key === "/" && !box && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); open(); }
    });
    $("#cmdkBtn") && ($("#cmdkBtn").onclick = open);
    return { open, close };
  }

  // ───────────── hero plate: a generative porcelain plate drawn from the markets ─────────────
  // Each ring is one market; its brush wave is that market's recent price path.
  function plate(canvas, getData, onHover) {
    let angle = 0, vel = reduce ? 0 : 0.0016, drag = null, hover = -1, raf = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) loop(); });
    io.observe(canvas);
    const ringOf = (x, y) => {
      const r = canvas.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2, R = Math.min(cx, cy) * 0.94;
      const d = Math.hypot(x - cx, y - cy) / R;
      if (d < 0.26 || d > 0.93) return -1;
      return Math.min(7, Math.floor((d - 0.26) / (0.67 / 8)));
    };
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, a: angle, t: performance.now() }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      if (drag) { const na = drag.a + (e.clientX - drag.x) * 0.008; vel = (na - angle) * 0.6; angle = na; }
      const h = ringOf(e.clientX - r.left, e.clientY - r.top);
      if (h !== hover) { hover = h; onHover(h); }
    });
    const end = () => { drag = null; if (!reduce && Math.abs(vel) < 0.0016) vel = 0.0016 * Math.sign(vel || 1); };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { if (!drag) { hover = -1; onHover(-1); } });
    canvas.addEventListener("click", (e) => { const r = canvas.getBoundingClientRect(); const h = ringOf(e.clientX - r.left, e.clientY - r.top); if (h >= 0 && !drag) canvas.dispatchEvent(new CustomEvent("ring", { detail: h })); });

    function draw() {
      const { ctx, w, h } = fit(canvas);
      const cx = w / 2, cy = h / 2, R = Math.min(cx, cy) * 0.94;
      const ink = css("--cobalt") || "#2346ff", glaze = css("--bg-2") || "#fff", bg3 = css("--bg-3") || "#e2e7ef";
      ctx.clearRect(0, 0, w, h);
      // plate body with soft glaze
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      g.addColorStop(0, glaze); g.addColorStop(1, bg3);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R * 0.955, 0, 7); ctx.stroke();
      const data = getData();
      data.forEach((vals, i) => {
        if (!vals || vals.length < 2) return;
        const r0 = R * (0.26 + (i + 0.5) * (0.67 / 8));
        const mn = Math.min(...vals), mx = Math.max(...vals), sp = mx - mn || 1;
        ctx.save();
        ctx.globalAlpha = hover === -1 || hover === i ? 1 : 0.25;
        ctx.strokeStyle = ink; ctx.lineWidth = hover === i ? 2.4 : 1.4; ctx.lineJoin = "round";
        ctx.beginPath();
        const n = vals.length;
        for (let k = 0; k <= n; k++) {
          const v = vals[k % n];
          const a = angle * (i % 2 ? -1 : 1) + (k / n) * Math.PI * 2;
          const rr = r0 + ((v - mn) / sp - 0.5) * (R * 0.055);
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        // brush dots like hand-painted glaze
        for (let k = 0; k < 12; k++) {
          const a = angle * (i % 2 ? -1 : 1) + (k / 12) * Math.PI * 2 + i * 0.3;
          ctx.fillStyle = ink; ctx.globalAlpha *= 0.9;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (r0 + R * 0.04), cy + Math.sin(a) * (r0 + R * 0.04), 1.3, 0, 7); ctx.fill();
        }
        ctx.restore();
      });
      // centre medallion: eight-petal flower, one petal per market
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle * 0.5);
      ctx.strokeStyle = ink; ctx.lineWidth = 1.6;
      for (let k = 0; k < 8; k++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.ellipse(0, -R * 0.12, R * 0.045, R * 0.11, 0, 0, 7);
        ctx.fillStyle = k === hover ? ink : "transparent"; ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, R * 0.035, 0, 7); ctx.fillStyle = ink; ctx.fill();
      ctx.restore();
    }
    function loop() {
      raf = 0;
      if (!canvas.isConnected) { io.disconnect(); return; }
      if (!drag) { angle += vel; if (!reduce) vel += (0.0016 * Math.sign(vel || 1) - vel) * 0.02; }
      draw();
      if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop);
    }
    document.addEventListener("ln:theme", () => draw());
    loop();
    return { redraw: draw };
  }

  // ───────────── heatmap: tile area ~ open interest (min share), colour = 24h change ─────────────
  function heatmap(host, markets, changes) {
    const oi = markets.map((m) => Number(m.longNotional + m.shortNotional));
    const tot = oi.reduce((a, b) => a + b, 0);
    // spans on a 12-column grid, weighting open interest with a floor so every market stays readable
    const weights = markets.map((m, i) => 1 + (tot ? (oi[i] / tot) * 8 : 0));
    const order = markets.map((m, i) => i).sort((a, b) => weights[b] - weights[a]);
    const spans = order.map((i, k) => (k < 2 ? 6 : k < 5 ? 4 : 4));
    host.innerHTML = order.map((i, k) => {
      const m = markets[i], c = changes[i];
      const t = Math.max(-1, Math.min(1, (isFinite(c) ? c : 0) / 4));
      const col = t >= 0 ? `color-mix(in srgb, var(--long) ${35 + t * 60}%, var(--ink))` : `color-mix(in srgb, var(--short) ${35 - t * 60}%, var(--ink))`;
      return `<a href="#/trade/${esc(m.symbol)}" style="grid-column:span ${spans[k]};grid-row:span ${k < 2 ? 2 : 1};background:${col}" aria-label="${esc(m.symbol)} ${pct(c)}"><b>${esc(m.symbol)}</b><span>${pct(c)}</span></a>`;
    }).join("");
  }

  // ───────────── exchange timeline (in the viewer's local time) ─────────────
  const EXCHANGES = [
    { name: "New York", tz: "America/New_York", sessions: [[570, 960]], note: "NYSE · Nasdaq, where these ADRs trade" },
    { name: "Hong Kong", tz: "Asia/Hong_Kong", sessions: [[570, 720], [780, 960]], note: "HKEX · many of these companies also list here" },
    { name: "Shanghai", tz: "Asia/Shanghai", sessions: [[570, 690], [780, 900]], note: "SSE · home market" },
  ];
  // minutes-from-local-midnight when a given zone's wall clock reads `mins`, for the current day
  function zoneOffsetMin(tz, date = new Date()) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute);
    return Math.round((asUTC - Math.floor(date.getTime() / 60000) * 60000) / 60000); // zone − UTC, minutes
  }
  function timeline(host) {
    const localOff = -new Date().getTimezoneOffset();
    host.innerHTML = `<div class="timeline" id="tl">
      ${EXCHANGES.map((x, i) => `<div class="tl-row"><b>${x.name}</b><div class="tl-track" data-ex="${i}"></div></div>`).join("")}
      <div class="tl-scale"><span></span><div>${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span>${String(h).padStart(2, "0")}</span>`).join("")}</div></div>
      <div class="tl-needle" id="tlNeedle" role="slider" tabindex="0" aria-label="Scrub time of day" aria-valuemin="0" aria-valuemax="1439"></div>
    </div>
    <div class="tl-readout"><b class="mono" id="tlTime"></b><span id="tlPills" class="row"></span><button class="btn btn--xs btn--ghost" id="tlNow">Back to now</button></div>
    <p class="faint small" style="margin:10px 0 0">Your local time. Weekends and exchange holidays are not shown. Drag the red needle, or use the arrow keys.</p>`;
    EXCHANGES.forEach((x, i) => {
      const off = zoneOffsetMin(x.tz) - localOff;
      const track = $(`[data-ex="${i}"]`, host);
      x.sessions.forEach(([a, b]) => {
        for (const shift of [-1440, 0, 1440]) {
          let s = a - off + shift, e = b - off + shift;
          s = Math.max(0, s); e = Math.min(1440, e);
          if (e > s) track.insertAdjacentHTML("beforeend", `<i class="${i === 0 ? "" : "alt"}" style="left:${(s / 1440) * 100}%;width:${((e - s) / 1440) * 100}%"></i>`);
        }
      });
    });
    const tl = $("#tl", host), needle = $("#tlNeedle", host);
    let scrub = null;
    const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    function place(min) {
      const rTl = tl.getBoundingClientRect(), rTr = $(".tl-track", host).getBoundingClientRect();
      const x = rTr.left - rTl.left + (min / 1440) * rTr.width;
      needle.style.left = `${x - 1}px`;
      needle.setAttribute("aria-valuenow", String(min));
      $("#tlTime", host).textContent = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}${scrub === null ? " · now" : ""}`;
      $("#tlPills", host).innerHTML = EXCHANGES.map((x) => {
        const zm = (((min - localOff + zoneOffsetMin(x.tz)) % 1440) + 1440) % 1440;
        const open = x.sessions.some(([a, b]) => zm >= a && zm < b);
        return `<span class="pill ${open ? "pill--open" : "pill--closed"}" title="${esc(x.note)}">${x.name} ${open ? "open" : "closed"}</span>`;
      }).join("");
    }
    const fromX = (clientX) => { const r = $(".tl-track", host).getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1439, ((clientX - r.left) / r.width) * 1440))); };
    tl.addEventListener("pointerdown", (e) => { scrub = fromX(e.clientX); tl.setPointerCapture(e.pointerId); place(scrub); tl.dataset.drag = "1"; });
    tl.addEventListener("pointermove", (e) => { if (tl.dataset.drag) { scrub = fromX(e.clientX); place(scrub); } });
    tl.addEventListener("pointerup", () => delete tl.dataset.drag);
    needle.addEventListener("keydown", (e) => { if (!/Arrow(Left|Right)/.test(e.key)) return; e.preventDefault(); scrub = Math.max(0, Math.min(1439, (scrub ?? nowMin()) + (e.key === "ArrowRight" ? 15 : -15))); place(scrub); });
    $("#tlNow", host).onclick = () => { scrub = null; place(nowMin()); };
    const tick = () => { if (!host.isConnected) { clearInterval(t); ro.disconnect(); return; } if (scrub === null) place(nowMin()); };
    const t = setInterval(tick, 20000);
    const ro = new ResizeObserver(() => place(scrub ?? nowMin())); ro.observe(tl);
    place(nowMin());
  }

  // ───────────── tools page ─────────────
  function tools(host, api) {
    const ms = api.markets();
    const opts = (sel) => ms.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.symbol)} · ${esc(m.name)}</option>`).join("");
    const pxOf = (id) => Number(ms[id].price) / 1e8;
    host.innerHTML = `
      <section class="panel tool" id="calcPnl"><span class="label">Calculator</span><h2>Profit, loss and liquidation</h2><p>Plan a trade before you place it. Drag on the chart to move the exit price.</p>
        <div class="grid2">
          <div class="field"><label class="label" for="pMarket">Market</label><div class="amount"><select id="pMarket">${opts(0)}</select></div></div>
          <div class="field"><span class="label">Side</span><div class="seg" id="pSide"><button type="button" data-s="long" class="on-long">Long</button><button type="button" data-s="short">Short</button></div></div>
          <div class="field"><label class="label" for="pMargin">Margin</label><div class="amount"><input id="pMargin" inputmode="decimal" value="1000"><span>USDG</span></div></div>
          <div class="field"><label class="label" for="pLev">Leverage <b class="mono" id="pLevV">5×</b></label><input type="range" class="lev" id="pLev" min="1" max="10" value="5"></div>
          <div class="field"><label class="label" for="pEntry">Entry price</label><div class="amount"><input id="pEntry" inputmode="decimal"><span>USD</span></div></div>
          <div class="field"><label class="label" for="pExit">Exit price</label><div class="amount"><input id="pExit" inputmode="decimal"><span>USD</span></div></div>
        </div>
        <div class="mini-chart"><canvas id="pChart" aria-label="Profit and loss by exit price"></canvas></div>
        <dl class="result" id="pOut"></dl>
      </section>
      <section class="panel tool" id="calcSize"><span class="label">Calculator</span><h2>Size by risk</h2><p>Decide how much you're willing to lose if the price reaches your stop, and get the margin and leverage that match it.</p>
        <div class="grid2">
          <div class="field"><label class="label" for="sAcct">Account size</label><div class="amount"><input id="sAcct" inputmode="decimal" value="10000"><span>USDG</span></div></div>
          <div class="field"><label class="label" for="sRisk">Risk per trade <b class="mono" id="sRiskV">1%</b></label><input type="range" class="lev" id="sRisk" min="0.25" max="5" step="0.25" value="1"></div>
          <div class="field"><label class="label" for="sEntry">Entry</label><div class="amount"><input id="sEntry" inputmode="decimal"><span>USD</span></div></div>
          <div class="field"><label class="label" for="sStop">Stop</label><div class="amount"><input id="sStop" inputmode="decimal"><span>USD</span></div></div>
        </div>
        <dl class="result" id="sOut"></dl>
        <div class="alerts" id="sLev"></div>
      </section>
      <section class="panel tool wide"><span class="label">Clock</span><h2>Which exchange is open?</h2><p>These companies trade in New York while their home markets sleep. Scrub through a day to see the overlap.</p><div id="tlHost"></div></section>
      <section class="panel tool wide" id="cmp"><span class="label">Compare</span><h2>Performance, side by side</h2><p>Every line starts at 0%, so markets with very different prices can be compared. Click a market to add or remove it.</p>
        <div class="filterbar" id="cmpPick">${ms.map((m, i) => `<button class="chipbtn ${i < 3 ? "on" : ""}" data-c="${m.id}">${esc(m.symbol)}</button>`).join("")}</div>
        <div class="mini-chart" style="height:260px"><canvas id="cmpChart"></canvas></div><div class="legend" id="cmpLegend"></div>
      </section>
      <section class="panel tool" id="alertTool"><span class="label">Alerts</span><h2>Price alerts</h2><p>Get a notice on this page when a market crosses your price. Alerts are kept in this browser only.</p>
        <div class="grid3">
          <div class="field"><label class="label" for="aMarket">Market</label><div class="amount"><select id="aMarket">${opts(0)}</select></div></div>
          <div class="field"><label class="label" for="aDir">When price is</label><div class="amount"><select id="aDir"><option value="above">Above</option><option value="below">Below</option></select></div></div>
          <div class="field"><label class="label" for="aPrice">Price</label><div class="amount"><input id="aPrice" inputmode="decimal"><span>USD</span></div></div>
        </div>
        <button class="btn btn--amber btn--block" id="aAdd" style="margin-top:14px">Add alert</button>
        <div class="alerts" id="aList"></div>
      </section>
      <section class="panel tool" id="fx"><span class="label">Converter</span><h2>USD, CNY, HKD</h2><p>Convert at the rates below. They are examples, not live quotes, so type in today's rates if you need them.</p>
        <div class="grid3">
          <div class="field"><label class="label" for="fxUsd">USD</label><div class="amount"><input id="fxUsd" inputmode="decimal" value="100"></div></div>
          <div class="field"><label class="label" for="fxCny">CNY</label><div class="amount"><input id="fxCny" inputmode="decimal"></div></div>
          <div class="field"><label class="label" for="fxHkd">HKD</label><div class="amount"><input id="fxHkd" inputmode="decimal"></div></div>
        </div>
        <div class="grid2" style="margin-top:4px">
          <div class="field"><label class="label" for="rCny">CNY per USD</label><div class="amount"><input id="rCny" inputmode="decimal" value="${ls.get("ln-rcny", 7.2)}"></div></div>
          <div class="field"><label class="label" for="rHkd">HKD per USD</label><div class="amount"><input id="rHkd" inputmode="decimal" value="${ls.get("ln-rhkd", 7.8)}"></div></div>
        </div>
      </section>`;

    // PnL calculator (same formulas as the contract)
    let side = "long", dragging = false;
    const P = (id) => $("#" + id, host);
    function setMarketPrices() { const p = pxOf(Number(P("pMarket").value)); P("pEntry").value = p.toFixed(2); P("pExit").value = (p * (side === "long" ? 1.05 : 0.95)).toFixed(2); }
    function calcPnl() {
      const margin = num(P("pMargin")), lev = Number(P("pLev").value), e = num(P("pEntry")), x = num(P("pExit"));
      P("pLevV").textContent = `${lev}×`;
      const fee = margin * lev * 0.001, net = margin - fee, size = net * lev;
      const dir = side === "long" ? 1 : -1;
      const pnl = (size * (x - e) / e) * dir, closeFee = size * 0.001, payout = Math.max(0, net + pnl - closeFee);
      const liq = e * (1 + dir * ((size * 0.05 - net) / size));
      const ok = [margin, e, x].every((v) => isFinite(v) && v > 0);
      P("pOut").innerHTML = ok ? [
        ["Result", `<span class="big ${payout - margin >= 0 ? "long" : "short"}">${money(payout - margin)}</span>`],
        ["Return on margin", pct(((payout - margin) / margin) * 100)], ["Position size", money(size)],
        ["Fees (open + close)", money(fee + closeFee)], ["Liquidation price", money(liq)],
        ["Move to liquidation", pct(((liq - e) / e) * 100)],
      ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("") : `<div><dt>Enter margin, entry and exit prices above zero.</dt></div>`;
      drawPnl(ok ? { e, x, liq, size, net, dir } : null);
    }
    function drawPnl(d) {
      const c = P("pChart"); const { ctx, w, h } = fit(c); ctx.clearRect(0, 0, w, h);
      if (!d) return;
      const lo = d.e * 0.8, hi = d.e * 1.2, X = (p) => ((p - lo) / (hi - lo)) * w;
      const pnlAt = (p) => Math.max(-d.net, (d.size * (p - d.e) / d.e) * d.dir);
      const maxAbs = d.size * 0.2 || 1, Y = (v) => h / 2 - (v / maxAbs) * (h / 2 - 12);
      ctx.strokeStyle = css("--line-2"); ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.lineWidth = 2;
      for (let px = 0; px < w; px += 2) {
        const p = lo + (px / w) * (hi - lo), v = pnlAt(p);
        ctx.strokeStyle = v >= 0 ? css("--long") : css("--short");
        ctx.beginPath(); ctx.moveTo(px, Y(v)); ctx.lineTo(px + 2, Y(pnlAt(lo + ((px + 2) / w) * (hi - lo)))); ctx.stroke();
      }
      ctx.font = "11px 'DM Mono', monospace"; ctx.fillStyle = css("--ink-3");
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      [[d.e, "entry", css("--ink-3")], [d.liq, "liq", css("--short")]].forEach(([p, l, col]) => { if (p < lo || p > hi) return; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(X(p), 0); ctx.lineTo(X(p), h); ctx.stroke(); ctx.fillStyle = col; ctx.fillText(l, X(p) + 4, 12); });
      ctx.setLineDash([]);
      const xx = Math.max(0, Math.min(w, X(d.x)));
      ctx.fillStyle = css("--cobalt"); ctx.beginPath(); ctx.arc(xx, Y(pnlAt(d.x)), 7, 0, 7); ctx.fill();
      ctx.fillStyle = css("--ink-3"); ctx.fillText(money(lo), 2, h - 4); ctx.textAlign = "right"; ctx.fillText(money(hi), w - 2, h - 4); ctx.textAlign = "left";
      c.dataset.lo = lo; c.dataset.hi = hi;
    }
    const pc = P("pChart");
    const scrubExit = (e) => { const r = pc.getBoundingClientRect(); const lo = +pc.dataset.lo, hi = +pc.dataset.hi; if (!isFinite(lo)) return; P("pExit").value = (lo + ((e.clientX - r.left) / r.width) * (hi - lo)).toFixed(2); calcPnl(); };
    pc.addEventListener("pointerdown", (e) => { dragging = true; pc.setPointerCapture(e.pointerId); scrubExit(e); });
    pc.addEventListener("pointermove", (e) => dragging && scrubExit(e));
    pc.addEventListener("pointerup", () => (dragging = false));
    $$("#pSide button", host).forEach((b) => (b.onclick = () => { side = b.dataset.s; $$("#pSide button", host).forEach((x) => (x.className = x === b ? `on-${side}` : "")); calcPnl(); }));
    P("pMarket").onchange = () => { setMarketPrices(); calcPnl(); };
    ["pMargin", "pLev", "pEntry", "pExit"].forEach((id) => P(id).addEventListener("input", calcPnl));
    setMarketPrices(); calcPnl();

    // risk sizer
    const sE = P("sEntry"); sE.value = pxOf(0).toFixed(2); P("sStop").value = (pxOf(0) * 0.95).toFixed(2);
    function calcSize() {
      const acct = num(P("sAcct")), risk = Number(P("sRisk").value), e = num(sE), s = num(P("sStop"));
      P("sRiskV").textContent = `${risk}%`;
      const ok = [acct, e, s].every((v) => isFinite(v) && v > 0) && e !== s;
      if (!ok) { P("sOut").innerHTML = `<div><dt>Enter an account size, and entry and stop prices that differ.</dt></div>`; P("sLev").innerHTML = ""; return; }
      const lossBudget = acct * (risk / 100), dist = Math.abs(e - s) / e, size = lossBudget / dist;
      const dir = s < e ? "Long" : "Short";
      P("sOut").innerHTML = [["Direction", dir], ["Max loss at stop", money(lossBudget)], ["Stop distance", pct(-dist * 100).replace("−", "")], ["Position size", `<span class="big">${money(size)}</span>`]].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("");
      P("sLev").innerHTML = [2, 5, 10].map((L) => {
        const margin = size / L, liqDist = (1 / L) * 0.95;
        const safe = liqDist > dist;
        return `<div class="alert-row"><b>${L}×</b><span class="faint">margin</span> ${money(margin)}<span class="mono ${safe ? "long" : "short"}">${safe ? "stop hits first" : "liquidated before stop"}</span></div>`;
      }).join("");
    }
    ["sAcct", "sRisk", "sEntry", "sStop"].forEach((id) => P(id).addEventListener("input", calcSize));
    calcSize();

    timeline(P("tlHost"));

    // compare
    const palette = () => [css("--cobalt"), css("--long"), css("--short"), css("--warn"), css("--ink-2"), css("--cobalt-2"), "#8a5cf6", "#0ea5b7"];
    async function drawCmp() {
      const sel = $$("#cmpPick .chipbtn.on", host).map((b) => Number(b.dataset.c));
      const series = await Promise.all(sel.map(async (id) => ({ id, pts: await api.history(id) })));
      const c = P("cmpChart"); if (!c.isConnected) return;
      const { ctx, w, h } = fit(c); ctx.clearRect(0, 0, w, h);
      const cols = palette();
      const norm = series.filter((s) => s.pts.length > 1).map((s) => ({ ...s, v: s.pts.map((p) => ({ t: p.t, v: (p.p / s.pts[0].p - 1) * 100 })) }));
      if (!norm.length) { ctx.fillStyle = css("--ink-3"); ctx.font = "13px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Pick at least one market with price history.", w / 2, h / 2); P("cmpLegend").innerHTML = ""; return; }
      const all = norm.flatMap((s) => s.v.map((p) => p.v)); let mn = Math.min(...all, 0), mx = Math.max(...all, 0); const pad = (mx - mn) * 0.1 || 1; mn -= pad; mx += pad;
      const t0 = Math.min(...norm.map((s) => s.v[0].t)), t1 = Math.max(...norm.map((s) => s.v[s.v.length - 1].t)) || t0 + 1;
      const X = (t) => 44 + ((t - t0) / (t1 - t0 || 1)) * (w - 50), Y = (v) => 8 + (1 - (v - mn) / (mx - mn)) * (h - 26);
      ctx.font = "11px 'DM Mono', monospace"; ctx.fillStyle = css("--ink-3"); ctx.strokeStyle = css("--line");
      for (let i = 0; i <= 4; i++) { const v = mn + ((mx - mn) * i) / 4; ctx.beginPath(); ctx.moveTo(44, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.fillText(`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, 0, Y(v) + 4); }
      ctx.strokeStyle = css("--line-2"); ctx.beginPath(); ctx.moveTo(44, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
      norm.forEach((s) => {
        ctx.strokeStyle = cols[s.id % cols.length]; ctx.lineWidth = 2; ctx.beginPath();
        s.v.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)))); ctx.stroke();
      });
      P("cmpLegend").innerHTML = norm.map((s) => `<span><i style="background:${cols[s.id % cols.length]}"></i>${esc(ms[s.id].symbol)} ${pct(s.v[s.v.length - 1].v)}</span>`).join("");
    }
    $$("#cmpPick .chipbtn", host).forEach((b) => (b.onclick = () => { b.classList.toggle("on"); drawCmp(); }));
    drawCmp();

    // alerts
    function renderAlerts() {
      const l = alerts.list();
      P("aList").innerHTML = l.length ? l.map((a) => `<div class="alert-row"><b>${esc(a.symbol)}</b><span class="faint">${a.dir}</span><span class="mono">${money(a.price)}</span><button class="btn btn--xs btn--ghost" data-rm="${a.id}" aria-label="Remove alert">Remove</button></div>`).join("") : `<p class="faint small" style="margin:6px 0 0">No alerts yet.</p>`;
      $$("[data-rm]", host).forEach((b) => (b.onclick = () => { alerts.remove(Number(b.dataset.rm)); renderAlerts(); }));
    }
    const setAlertDefault = () => { const p = pxOf(Number(P("aMarket").value)); P("aPrice").value = (p * (P("aDir").value === "above" ? 1.01 : 0.99)).toFixed(2); };
    P("aMarket").onchange = setAlertDefault; P("aDir").onchange = setAlertDefault; setAlertDefault();
    P("aAdd").onclick = () => {
      const price = num(P("aPrice")); const m = ms[Number(P("aMarket").value)];
      if (!(price > 0)) { api.toast("err", "Enter a price", "Alerts need a price above zero."); return; }
      alerts.add({ symbol: m.symbol, dir: P("aDir").value, price });
      api.toast("ok", "Alert added", `${m.symbol} ${P("aDir").value} ${money(price)}`);
      renderAlerts();
    };
    renderAlerts();

    // converter
    const fxIds = ["fxUsd", "fxCny", "fxHkd"];
    function conv(from) {
      const rc = num(P("rCny")), rh = num(P("rHkd"));
      if (!(rc > 0 && rh > 0)) return;
      ls.set("ln-rcny", rc); ls.set("ln-rhkd", rh);
      const v = num(P(from)); if (!isFinite(v)) return;
      const usd = from === "fxUsd" ? v : from === "fxCny" ? v / rc : v / rh;
      if (from !== "fxUsd") P("fxUsd").value = usd.toFixed(2);
      if (from !== "fxCny") P("fxCny").value = (usd * rc).toFixed(2);
      if (from !== "fxHkd") P("fxHkd").value = (usd * rh).toFixed(2);
    }
    fxIds.forEach((id) => P(id).addEventListener("input", () => conv(id)));
    ["rCny", "rHkd"].forEach((id) => P(id).addEventListener("input", () => conv("fxUsd")));
    conv("fxUsd");

    document.addEventListener("ln:theme", () => { if (host.isConnected) { calcPnl(); drawCmp(); } });
    return { refresh() { if (host.isConnected) drawCmp(); } };
  }

  window.LN_TOOLS = { initTheme, initPalette, watch, alerts, plate, heatmap, timeline, tools, css };
})();
