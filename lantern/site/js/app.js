// Lantern — app shell, router and views
(function () {
  const { ethers } = window;
  const CFG = window.LN_CONFIG;
  const B = window.LN_BACKEND;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const main = $("#main");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BPS = 10000n;
  const cssv = (n) => window.LN_TOOLS.css(n);
  // add alpha to any CSS colour for canvas gradients
  const alpha = (col, a) => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = col; const v = c.fillStyle; if (v.startsWith("#")) { const n = parseInt(v.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; } return v.replace(/rgba?\(([^)]+)\)/, (m, g) => `rgba(${g.split(",").slice(0, 3).join(",")},${a})`); };

  // ───────────────────────── utils ─────────────────────────
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
  const dec = () => (state.be ? state.be.decimals : 6);
  const toUsd = (units) => (units === null || units === undefined ? NaN : Number(units) / 10 ** dec());
  const toPx = (p) => Number(p) / 1e8;
  const money = (n, d = 2) => (!isFinite(n) ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const compact = (n) => (!isFinite(n) ? "—" : Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e4 ? "$" + (n / 1e3).toFixed(1) + "K" : money(n));
  const pxFmt = (n) => (!isFinite(n) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 3 : 2 }));
  const pct = (n) => (!isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
  const parseUnits = (s) => {
    const v = String(s || "").trim().replace(/,/g, "");
    if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
    try { const [i, f = ""] = v.split("."); return ethers.parseUnits(`${i || "0"}.${f.slice(0, dec()) || "0"}`, dec()); } catch { return null; }
  };
  const ago = (t) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - t)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
  const badge = (m) => `<span class="tick__badge" style="background:linear-gradient(135deg,hsl(${m.hue} 80% 66%),hsl(${(m.hue + 30) % 360} 70% 48%))">${esc(m.symbol.slice(0, 4))}</span>`;

  // ───────────────────────── state ─────────────────────────
  const state = { net: null, be: null, markets: [], hist: new Map(), params: null, unsub: null };

  function change24(i) {
    const h = state.hist.get(i);
    if (!h || h.length < 2) return NaN;
    const cut = Date.now() / 1000 - 86400;
    let base = h[0].p;
    for (const x of h) { if (x.t <= cut) base = x.p; else break; }
    const now = toPx(state.markets[i]?.price ?? 0) || h[h.length - 1].p;
    return base ? ((now - base) / base) * 100 : NaN;
  }

  // ───────────────────────── toasts ─────────────────────────
  function toast(kind, title, body, ms = 4500) {
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.innerHTML = `<i></i><div><b></b><span class="muted small"></span></div>`;
    t.querySelector("b").textContent = title;
    t.querySelector(".muted").textContent = body || "";
    $("#toasts").appendChild(t);
    const kill = () => t.remove();
    if (ms) setTimeout(kill, ms);
    return { set(a, b2, k) { if (k) t.className = `toast ${k}`; t.querySelector("b").textContent = a; t.querySelector(".muted").textContent = b2 || ""; }, kill, done(ms2 = 4000) { setTimeout(kill, ms2); } };
  }
  async function run(label, fn) {
    const t = toast("wait", label, "Preparing…", 0);
    try { const r = await fn((m) => t.set(label, m)); t.set("Done", label.replace(/…$/, ""), "ok"); t.done(); return r ?? true; }
    catch (e) { console.warn(e); t.set("Couldn't finish", B.friendly(e), "err"); t.done(7000); return false; }
  }

  // ───────────────────────── network & wallet ─────────────────────────
  function setNet(n, silent) {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.net = n; state.be = B.make(n); state.markets = []; state.hist = new Map(); state.params = null;
    ls.set("ln-net", n.key);
    $$(".net").forEach((s) => (s.value = n.key));
    const b = $("#banner");
    if (n.demo) {
      b.innerHTML = `<div class="banner">Demo network: prices are simulated and no real money moves.<button id="resetDemo">Reset demo</button></div>`;
      $("#resetDemo").onclick = () => { state.be.reset(); toast("ok", "Demo reset", "Fresh prices and a refilled wallet."); setNet(n); };
    } else b.innerHTML = "";
    wallet();
    if (!silent) route();
  }
  async function wallet() {
    const a = state.be?.account;
    $("#walletDot").classList.toggle("on", !!a);
    if (!a) { $("#walletLabel").textContent = "Connect"; return; }
    let bal = "";
    try { const v = await state.be.balance(); if (v !== null) bal = ` · ${compact(toUsd(v))}`; } catch { /* ignore */ }
    $("#walletLabel").textContent = `${a.slice(0, 6)}…${a.slice(-4)}${bal}`;
  }
  async function connect() {
    try {
      await state.be.connect();
      toast("ok", "Wallet connected", state.net.demo ? "Your demo wallet holds 10,000 USDG." : "");
      wallet(); document.dispatchEvent(new Event("ln:wallet"));
      return true;
    } catch (e) { toast("err", "Couldn't connect", B.friendly(e)); return false; }
  }
  $("#wallet").onclick = () => {
    if (state.be.account) { state.be.disconnect(); wallet(); toast("ok", "Disconnected", ""); document.dispatchEvent(new Event("ln:wallet")); }
    else connect();
  };
  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", () => { if (!state.net.demo) { state.be.disconnect(); wallet(); document.dispatchEvent(new Event("ln:wallet")); } });
    window.ethereum.on("chainChanged", () => { if (!state.net.demo) { state.be.disconnect(); wallet(); } });
  }

  async function loadMarkets() {
    try {
      state.markets = await state.be.markets();
      if (!state.params) state.params = await state.be.params();
    } catch (e) { console.warn(e); toast("err", "Couldn't load markets", B.friendly(e)); state.markets = []; }
    return state.markets;
  }
  async function loadHist(i, force) {
    if (state.hist.has(i) && !force) return state.hist.get(i);
    try { state.hist.set(i, await state.be.history(i)); } catch (e) { console.warn(e); state.hist.set(i, []); }
    return state.hist.get(i);
  }
  // live updates for the current view only
  let viewTick = null;
  function onTick(fn) { viewTick = fn; }
  function startFeed() {
    if (state.unsub) state.unsub();
    state.unsub = state.be.subscribe(async (ev) => {
      if (ev.liquidated?.length) state.sky?.lightning();
      if (ev.liquidated?.length) ev.liquidated.forEach((p) => toast("err", "Position liquidated", `${state.markets[p.marketId]?.symbol || ""} ${p.isLong ? "long" : "short"} fell below maintenance margin.`, 8000));
      const prev = state.markets.map((m) => m.price);
      await loadMarkets();
      if (state.be.demo) state.hist.clear(); // simulated feed moves every tick
      updateWeather();
      renderTicker();
      window.LN_TOOLS.alerts.check(state.markets).forEach((a) => toast("alert", `${a.symbol} is ${a.dir} ${money(a.price)}`, `Now ${pxFmt(a.now)}`, 9000));
      if (viewTick) viewTick(prev);
      wallet();
    });
  }

  // ───────────────────────── canvas helpers ─────────────────────────
  function fit(c) {
    const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }
  function spark(c, vals, up) {
    if (!c) return;
    const { ctx, w, h } = fit(c);
    ctx.clearRect(0, 0, w, h);
    if (!vals || vals.length < 2) return;
    const mn = Math.min(...vals), mx = Math.max(...vals), sp = mx - mn || 1;
    const col = cssv(up ? "--long" : "--short");
    ctx.beginPath();
    vals.forEach((v, i) => { const x = (i / (vals.length - 1)) * w, y = h - 2 - ((v - mn) / sp) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, alpha(col, .2)); g.addColorStop(1, alpha(col, 0)); ctx.fillStyle = g; ctx.fill();
  }

  function sky(canvas) {
    const lanterns = Array.from({ length: innerWidth < 700 ? 16 : 30 }, () => mk(true));
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.7, s: Math.random() * 1.2 + 0.2, p: Math.random() * 6 }));
    function mk(anywhere) {
      const z = Math.random();
      return { x: Math.random(), y: anywhere ? Math.random() * 1.1 : 1.1 + Math.random() * 0.2, z, v: 0.00012 + z * 0.00035, sw: Math.random() * 6, w: 10 + z * 22 };
    }
    let raf = 0, vis = true;
    const io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis && !raf) loop(); });
    io.observe(canvas);
    function draw(t) {
      const { ctx, w, h } = fit(canvas);
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) { ctx.fillStyle = `rgba(241,233,216,${0.25 + 0.25 * Math.sin(t / 900 + s.p)})`; ctx.fillRect(s.x * w, s.y * h, s.s, s.s); }
      lanterns.sort((a, b) => a.z - b.z);
      for (const l of lanterns) {
        if (!reduce) { l.y -= l.v; l.sw += 0.01; }
        if (l.y < -0.15) Object.assign(l, mk(false));
        const x = l.x * w + Math.sin(l.sw) * 14 * l.z, y = l.y * h, lw = l.w, lh = lw * 1.25;
        const g = ctx.createRadialGradient(x, y, 0, x, y, lw * 3);
        g.addColorStop(0, `rgba(244,163,64,${0.18 + l.z * 0.22})`); g.addColorStop(1, "rgba(244,163,64,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, lw * 3, 0, 7); ctx.fill();
        const body = ctx.createLinearGradient(x, y - lh / 2, x, y + lh / 2);
        body.addColorStop(0, `rgba(255,214,150,${0.55 + l.z * 0.45})`); body.addColorStop(1, `rgba(214,96,40,${0.55 + l.z * 0.45})`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(x - lw * 0.42, y - lh / 2); ctx.lineTo(x + lw * 0.42, y - lh / 2);
        ctx.quadraticCurveTo(x + lw * 0.62, y, x + lw * 0.4, y + lh / 2); ctx.lineTo(x - lw * 0.4, y + lh / 2);
        ctx.quadraticCurveTo(x - lw * 0.62, y, x - lw * 0.42, y - lh / 2); ctx.fill();
        ctx.fillStyle = `rgba(255,240,200,${0.5 * l.z})`; ctx.fillRect(x - lw * 0.12, y + lh / 2 - 2, lw * 0.24, 2);
      }
    }
    function loop(t = performance.now()) {
      raf = 0;
      if (!canvas.isConnected) { io.disconnect(); return; }
      draw(t);
      if (vis && !reduce && !document.hidden) raf = requestAnimationFrame(loop);
    }
    loop();
  }

  // a single oracle update still deserves a line: hold it flat until now
  const withNow = (pts) => (pts.length === 1 ? [pts[0], { t: Math.max(pts[0].t + 60, Math.floor(Date.now() / 1000)), p: pts[0].p }] : pts);
  // price chart: timeframe filter, hover crosshair, and drag-to-measure between two points
  function chart(host, input, fmt) {
    let all = withNow(input), range = 86400, pts = all;
    host.innerHTML = `<canvas></canvas><div class="tip"></div>`;
    const c = host.querySelector("canvas"), tip = host.querySelector(".tip");
    let hover = -1, entries = [], sel = null, dragging = false;
    const apply = () => {
      const end = all.length ? all[all.length - 1].t : 0;
      pts = all.filter((p) => p.t >= end - range);
      if (pts.length < 2) pts = all.slice(-2);
      sel = null;
    };
    apply();
    const draw = () => {
      const { ctx, w, h } = fit(c);
      ctx.clearRect(0, 0, w, h);
      if (pts.length < 2) { ctx.fillStyle = cssv("--ink-3"); ctx.font = "13px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Waiting for price history…", w / 2, h / 2); return; }
      const L = 8, R = 70, T = 14, Bm = 26;
      const vs = pts.map((p) => p.p).concat(entries.map((e) => e.v));
      let mn = Math.min(...vs), mx = Math.max(...vs); const pad = (mx - mn) * 0.1 || mx * 0.01; mn -= pad; mx += pad;
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t, ts = t1 - t0 || 1;
      const X = (t) => L + ((t - t0) / ts) * (w - L - R), Y = (v) => T + (1 - (v - mn) / (mx - mn)) * (h - T - Bm);
      ctx.font = "11px 'DM Mono', monospace"; ctx.fillStyle = cssv("--ink-3"); ctx.strokeStyle = cssv("--line");
      for (let i = 0; i <= 4; i++) { const v = mn + ((mx - mn) * i) / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R + 4, y); ctx.stroke(); ctx.textAlign = "left"; ctx.fillText(fmt.axis(v), w - R + 8, y + 4); }
      ctx.textAlign = "center";
      for (let i = 0; i <= 3; i++) { const t = t0 + (ts * i) / 3; ctx.fillText(fmt.time(t), Math.min(Math.max(X(t), 28), w - R - 28), h - 7); }
      const up = pts[pts.length - 1].p >= pts[0].p, col = cssv(up ? "--long" : "--short");
      // measured band
      if (sel && sel.b !== undefined && sel.a !== sel.b) {
        const [i0, i1] = sel.a < sel.b ? [sel.a, sel.b] : [sel.b, sel.a];
        const pa = pts[i0], pb = pts[i1], chg = ((pb.p - pa.p) / pa.p) * 100, mc = cssv(chg >= 0 ? "--long" : "--short");
        ctx.fillStyle = alpha(mc, 0.1); ctx.fillRect(X(pa.t), T, X(pb.t) - X(pa.t), h - T - Bm);
        ctx.strokeStyle = mc; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(pa.t), Y(pa.p)); ctx.lineTo(X(pb.t), Y(pb.p)); ctx.stroke(); ctx.setLineDash([]);
        const label = `${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}% · ${fmt.value(pb.p - pa.p).replace("$-", "−$")} · ${Math.round((pb.t - pa.t) / 60)} min`;
        ctx.font = "600 12px 'DM Mono', monospace"; const tw = ctx.measureText(label).width + 16;
        const lx = Math.min(Math.max((X(pa.t) + X(pb.t)) / 2 - tw / 2, L), w - R - tw);
        ctx.fillStyle = cssv("--solid"); ctx.fillRect(lx, T + 4, tw, 24); ctx.fillStyle = mc; ctx.textAlign = "left"; ctx.fillText(label, lx + 8, T + 20);
        ctx.font = "11px 'DM Mono', monospace";
      }
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.p)) : ctx.moveTo(X(p.t), Y(p.p))));
      ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.stroke();
      ctx.lineTo(X(t1), h - Bm); ctx.lineTo(X(t0), h - Bm); ctx.closePath();
      const g = ctx.createLinearGradient(0, T, 0, h - Bm); g.addColorStop(0, alpha(col, .19)); g.addColorStop(1, alpha(col, 0)); ctx.fillStyle = g; ctx.fill();
      for (const e of entries) {
        if (e.v < mn || e.v > mx) continue;
        const y = Y(e.v); ctx.setLineDash([4, 4]); ctx.strokeStyle = e.color; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R + 4, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = e.color; ctx.textAlign = "left"; ctx.fillText(e.label, L + 4, y - 5);
      }
      const last = pts[pts.length - 1], ly = Y(last.p);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(last.t), ly, 3.5, 0, 7); ctx.fill();
      if (hover >= 0 && hover < pts.length && !dragging) {
        const p = pts[hover], x = X(p.t), y = Y(p.p);
        ctx.strokeStyle = cssv("--line-2"); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - Bm); ctx.stroke();
        ctx.fillStyle = cssv("--ink"); ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
        tip.textContent = `${fmt.value(p.p)} · ${fmt.full(p.t)}`; tip.style.opacity = 1;
        tip.style.left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), w - tip.offsetWidth) + "px"; tip.style.top = Math.max(y - 40, 0) + "px";
      } else tip.style.opacity = 0;
      draw.X = X;
    };
    const idxAt = (x) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.abs(draw.X(p.t) - x); if (d < bd) { bd = d; bi = i; } }); return bi; };
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => { if (!draw.X) return; dragging = true; c.setPointerCapture(e.pointerId); sel = { a: idxAt(e.offsetX) }; draw(); });
    c.addEventListener("pointermove", (e) => { if (!draw.X) return; const i = idxAt(e.offsetX); if (dragging) sel.b = i; else hover = i; draw(); });
    c.addEventListener("pointerup", () => { dragging = false; if (sel && (sel.b === undefined || sel.b === sel.a)) sel = null; draw(); });
    c.addEventListener("pointerleave", () => { hover = -1; if (!dragging) draw(); });
    c.addEventListener("dblclick", () => { sel = null; draw(); });
    new ResizeObserver(draw).observe(host);
    draw();
    return {
      update(np, ne) { const keep = sel; all = withNow(np); const end = all[all.length - 1]?.t ?? 0; pts = all.filter((p) => p.t >= end - range); if (pts.length < 2) pts = all.slice(-2); sel = keep && keep.b !== undefined && Math.max(keep.a, keep.b) < pts.length ? keep : null; entries = ne || entries; draw(); },
      setEntries(ne) { entries = ne; draw(); },
      setRange(r) { range = r; apply(); draw(); },
      measured: () => sel && sel.b !== undefined && sel.a !== sel.b,
    };
  }

  // ───────────────────────── clocks ─────────────────────────
  function zoneParts(tz) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const o = Object.fromEntries(f.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const h = Number(o.hour) % 24, m = Number(o.minute), s = Number(o.second);
    return { h, m, s, wd: o.weekday, label: `${String(h).padStart(2, "0")}:${o.minute}:${o.second}` };
  }
  const weekday = (wd) => !["Sat", "Sun"].includes(wd);
  function nyOpen() { const z = zoneParts("America/New_York"); const mins = z.h * 60 + z.m; return weekday(z.wd) && mins >= 570 && mins < 960; }
  function shOpen() { const z = zoneParts("Asia/Shanghai"); const mins = z.h * 60 + z.m; return weekday(z.wd) && ((mins >= 570 && mins < 690) || (mins >= 780 && mins < 900)); }
  function renderClocks() {
    const el = $("#clocks");
    if (!el) return false;
    [["ny", "America/New_York", nyOpen()], ["sh", "Asia/Shanghai", shOpen()]].forEach(([k, tz, open]) => {
      const z = zoneParts(tz);
      $(`#${k}Time`).textContent = `${z.wd} ${z.label}`;
      $(`#${k}H`).style.transform = `rotate(${(z.h % 12) * 30 + z.m / 2}deg)`;
      $(`#${k}M`).style.transform = `rotate(${z.m * 6}deg)`;
      const p = $(`#${k}Pill`); p.textContent = open ? "Open" : "Closed"; p.className = `pill ${open ? "pill--open" : "pill--closed"}`;
    });
    const ny = nyOpen(), sh = shOpen();
    $("#clockNote").textContent = ny && !sh ? "Right now New York is trading these names while Shanghai sleeps." : sh && !ny ? "Shanghai is trading. The New York listings reopen at 9:30 ET." : ny && sh ? "Both exchanges are open." : "Both exchanges are closed. Oracle prices hold at the last update until trading resumes.";
    return true;
  }
  let clockTimer = null;

  function shortcuts() {
    if ($(".shortcuts")) { $(".shortcuts").remove(); return; }
    const d = document.createElement("div");
    d.className = "cmdk shortcuts";
    d.innerHTML = `<div class="cmdk__box" role="dialog" aria-label="Keyboard shortcuts"><div style="padding:20px 22px 6px"><span class="label">Keyboard</span><h2 class="h3" style="margin:8px 0 0">Shortcuts</h2></div><ul>${[
      ["Ctrl K or /", "Search markets and pages"], ["L / S", "Choose long or short"], ["1 – 9, 0", "Set leverage (0 = 10×)"], ["M", "Jump to the margin field"],
      ["← / →", "Previous or next market"], ["?", "Show or hide this list"], ["Esc", "Close"],
    ].map(([k, v]) => `<li><span>${v}</span><span class="kbd">${k}</span></li>`).join("")}</ul></div>`;
    d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
    document.body.appendChild(d);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $(".shortcuts")?.remove(); });

  // ───────────────────────── views ─────────────────────────
  const views = {};

  const starSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  function boardRow(m) {
    const ch = change24(m.id);
    const on = window.LN_TOOLS.watch.has(m.symbol);
    return `<a class="board__row" href="#/trade/${esc(m.symbol)}" data-row="${m.id}">
      <button class="star ${on ? "on" : ""}" data-star="${esc(m.symbol)}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} watchlist">${starSvg}</button>
      <div class="tick">${badge(m)}<div style="min-width:0"><div class="tick__sym">${esc(m.symbol)}</div><div class="tick__name">${esc(m.name)}</div></div></div>
      <div class="mono price-cell" data-px="${m.id}">${pxFmt(toPx(m.price))}</div>
      <div class="mono ${ch >= 0 ? "long" : "short"}" data-ch="${m.id}">${pct(ch)}</div>
      <div><canvas data-spark="${m.id}" aria-hidden="true"></canvas></div>
      <div class="row" style="gap:6px;flex-wrap:nowrap"><span class="btn btn--xs btn--jade" data-go="long">Long</span><span class="btn btn--xs btn--cinnabar" data-go="short">Short</span></div>
    </a>`;
  }
  function board(host, filter = () => true) {
    const rows = state.markets.filter(filter);
    host.innerHTML = `<div class="board__row board__row--head"><span></span><span class="label">Market</span><span class="label">Price</span><span class="label">24h</span><span class="label">24h chart</span><span class="label" style="text-align:right">Trade</span></div>` + (rows.length ? rows.map(boardRow).join("") : `<div class="empty"><p>No markets match. Star a market to add it to your watchlist.</p></div>`);
    $$("[data-star]", host).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const on = window.LN_TOOLS.watch.toggle(b.dataset.star); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", `${on ? "Remove from" : "Add to"} watchlist`); toast("ok", on ? "Added to watchlist" : "Removed from watchlist", b.dataset.star, 2000); }));
    $$("[data-go]", host).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); const row = b.closest("[data-row]"); location.hash = `#/trade/${state.markets[row.dataset.row].symbol}?side=${b.dataset.go}`; }));
    drawSparks(host);
  }
  async function drawSparks(host) {
    for (const m of state.markets) {
      const h = await loadHist(m.id);
      spark($(`[data-spark="${m.id}"]`, host), h.map((x) => x.p), change24(m.id) >= 0);
      const chEl = $(`[data-ch="${m.id}"]`, host);
      if (chEl) { const ch = change24(m.id); chEl.textContent = pct(ch); chEl.className = `mono ${ch >= 0 ? "long" : "short"}`; }
    }
  }
  function updateBoard(host, prev) {
    state.markets.forEach((m, i) => {
      const el = $(`[data-px="${m.id}"]`, host);
      if (!el) return;
      el.textContent = pxFmt(toPx(m.price));
      if (prev && prev[i] !== undefined && prev[i] !== m.price) { el.classList.remove("flash-up", "flash-down"); void el.offsetWidth; el.classList.add(m.price > prev[i] ? "flash-up" : "flash-down"); }
    });
    drawSparks(host);
  }

  views.home = async () => {
    main.innerHTML = `
    <section class="hero"><div class="wrap hero__in">
      <div class="hero__copy">
        <span class="kicker reveal">Eight markets · 1× to 10×</span>
        <h1 class="display reveal" style="--d:.06s;margin-top:22px">China's giants, <span class="glow">around the clock.</span></h1>
        <p class="lead reveal" style="--d:.12s">Go long or short on eight US-listed Chinese companies. Post margin in USDG, pick your leverage, and settle on chain.</p>
        <div class="row reveal" style="--d:.18s"><a class="btn btn--amber" href="#/trade/BABA">Start trading →</a><a class="btn btn--ghost" href="#/tools">Open the tools</a></div>
        <div class="hero__stats reveal" style="--d:.24s"><div><span class="label">Markets</span><b>8</b></div><div><span class="label">Max leverage</span><b>10×</b></div><div><span class="label">Fee per side</span><b>0.10%</b></div><div><span class="label">Vault</span><b id="heroVault">—</b></div></div>
      </div>
      <div class="reveal" style="--d:.2s">
        <div class="plate-wrap" id="plateWrap"><canvas id="plate" aria-label="Spinning plate: each ring is one market's recent price path. Drag to spin, click a ring to trade it."></canvas><div class="plate-tip" id="plateTip">Drag to spin · click a ring</div></div>
      </div>
    </div></section>

    <section class="section" style="padding-top:16px"><div class="wrap">
      <div class="head"><div><span class="kicker">Markets</span><h2 class="h2">Eight names. Two directions.</h2></div><div class="row"><span class="weather" data-weather></span><span class="faint small mono" id="feedNote"></span></div></div>
      <div class="board" id="board"><div class="empty">Loading markets…</div></div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap two">
      <div class="panel"><span class="label">Heatmap · 24h change</span><h3 class="h3" style="margin:8px 0 16px">Who's moving</h3><div class="heat" id="heat"></div><p class="faint small" style="margin:12px 0 0">Bigger tiles carry more open interest. Click a tile to trade it.</p></div>
      <div class="panel"><span class="label">Exchange clock</span><h3 class="h3" style="margin:8px 0 16px">Who's open right now</h3><div id="tlHome"></div></div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <div class="head"><div><span class="kicker">How a trade works</span><h2 class="h2">Margin in, position out.</h2></div></div>
      <div class="steps">
        <article class="step"><svg class="ico" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2"><circle cx="22" cy="22" r="18"/><path d="M15 22h14M22 15v14"/></svg><h3 class="h3">Post margin</h3><p>Deposit USDG. A 0.1% fee on the position size is taken when you open and again when you close.</p></article>
        <article class="step"><svg class="ico" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 32l10-10 7 7 15-17"/><path d="M29 12h9v9"/></svg><h3 class="h3">Pick a side</h3><p>Long if you expect the price to rise, short if you expect it to fall, with 1× to 10× leverage.</p></article>
        <article class="step"><svg class="ico" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2"><circle cx="22" cy="22" r="18"/><path d="M22 12v10l6 5"/></svg><h3 class="h3">Close, or be closed</h3><p>Close whenever the feed is live. Below 5% equity, anyone can liquidate the position.</p></article>
      </div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <div class="head"><div><span class="kicker">The vault</span><h2 class="h2">Every trade has a counterparty.</h2></div><a class="btn btn--ghost btn--sm" href="#/vault">Provide liquidity →</a></div>
      <div class="stats" id="vaultStats">${["Vault assets", "Open interest", "Net exposure", "Exposure cap"].map((k) => `<div class="stat"><span class="label">${k}</span><div class="stat__v">—</div><div class="stat__s"></div></div>`).join("")}</div>
      <p class="note" style="margin-top:24px">Lantern is not affiliated with, endorsed by or a broker for any company listed here. You never own the shares. Positions only track their price.</p>
    </div></section>`;

    await loadMarkets();
    if (!$("#board")) return;
    await Promise.all(state.markets.map((m) => loadHist(m.id)));
    if (!$("#board")) return;
    const T = window.LN_TOOLS;
    T.plate($("#plate"), () => state.markets.map((m) => (state.hist.get(m.id) || []).map((x) => x.p)), (i) => {
      const m = state.markets[i];
      $("#plateTip").textContent = m ? `${m.symbol} ${pxFmt(toPx(m.price))} · ${pct(change24(i))}` : "Drag to spin · click a ring";
    });
    $("#plate").addEventListener("ring", (e) => { const m = state.markets[e.detail]; if (m) location.hash = `#/trade/${m.symbol}`; });
    board($("#board"));
    updateWeather();
    T.heatmap($("#heat"), state.markets, state.markets.map((m) => change24(m.id)));
    T.timeline($("#tlHome"));
    $("#feedNote").textContent = state.net.demo ? "Simulated feed · updates every 3 s" : `Oracle feed · ${state.net.name}`;
    const vs = async () => {
      try {
        const v = await state.be.vault();
        if (!$("#vaultStats")) return;
        const oi = state.markets.reduce((a, m) => a + toUsd(m.longNotional) + toUsd(m.shortNotional), 0);
        const cap = Number(state.params?.maxNetExposureBps ?? 5000n) / 100;
        const vals = [[compact(toUsd(v.assets)), "USDG backing every position"], [compact(oi), "long + short, all markets"], [compact(toUsd(v.net)), "what the vault is exposed to"], [`${cap}%`, "of vault assets, max net exposure"]];
        $$("#vaultStats .stat").forEach((s, i) => { $(".stat__v", s).textContent = vals[i][0]; $(".stat__s", s).textContent = vals[i][1]; });
        $("#heroVault").textContent = compact(toUsd(v.assets));
      } catch (e) { console.warn(e); }
    };
    vs();
    onTick(async (prev) => {
      if (!$("#board")) return;
      updateBoard($("#board"), prev);
      await Promise.all(state.markets.map((m) => loadHist(m.id)));
      if (!$("#heat")) return;
      T.heatmap($("#heat"), state.markets, state.markets.map((m) => change24(m.id)));
      vs();
    });
  };

  views.markets = async (params) => {
    let filter = params.get("show") === "watch" ? "watch" : "all", q = "";
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="head"><div><span class="kicker">Markets</span><h1 class="h2">All markets</h1></div><div class="row"><span class="weather" data-weather></span><span class="faint small mono" id="feedNote"></span></div></div>
      <div class="filterbar"><button class="chipbtn" data-f="all">All</button><button class="chipbtn" data-f="watch">Watchlist</button><input class="search" id="mSearch" placeholder="Search ticker or name" aria-label="Search markets"><span class="faint small">Press <span class="kbd">/</span> to jump anywhere</span></div>
      <div class="board" id="board"><div class="empty">Loading markets…</div></div>
    </div></section>`;
    await loadMarkets();
    if (!$("#board")) return;
    const f = (m) => (filter !== "watch" || window.LN_TOOLS.watch.has(m.symbol)) && (!q || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    const render = () => { $$("[data-f]").forEach((b) => b.classList.toggle("on", b.dataset.f === filter)); board($("#board"), f); };
    $$("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; render(); }));
    $("#mSearch").oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
    render();
    await Promise.all(state.markets.map((m) => loadHist(m.id)));
    updateWeather();
    if (!$("#feedNote")) return;
    $("#feedNote").textContent = state.net.demo ? "Simulated feed · updates every 3 s" : `Oracle feed · ${state.net.name}`;
    onTick((prev) => $("#board") && updateBoard($("#board"), prev));
  };

  views.zcash = () => { window.LN_ZCASH.render(main); };

  views.tools = async () => {
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="head"><div><span class="kicker">Tools</span><h1 class="h2">Plan before you trade</h1><p class="lead" style="margin-top:12px">Calculators, an exchange clock, a comparison chart, price alerts and a currency converter. They all use the same formulas as the contracts.</p></div></div>
      <div class="tools" id="toolsHost"><div class="empty">Loading…</div></div>
    </div></section>`;
    await loadMarkets();
    if (!$("#toolsHost")) return;
    const t = window.LN_TOOLS.tools($("#toolsHost"), { markets: () => state.markets, history: (i) => loadHist(i), toast });
    onTick(() => t.refresh());
  };

  function positionsTable(list, { withActions = true } = {}) {
    if (!state.be.account) return `<div class="empty"><p>Connect a wallet to see your positions.</p><button class="btn btn--sm" data-connect>Connect</button></div>`;
    if (!list.length) return `<div class="empty"><p>No open positions.</p></div>`;
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq. price</th><th>Margin</th><th>PnL</th>${withActions ? "<th></th>" : ""}</tr></thead><tbody>
      ${list.map((p) => {
        const m = state.markets[p.marketId] || { symbol: "?" };
        const pnl = toUsd(p.pnl), roe = (pnl / toUsd(p.margin)) * 100;
        const lev = Number(p.size) / Number(p.margin);
        return `<tr data-pos="${p.id}"><td><b>${esc(m.symbol)}</b></td><td class="${p.isLong ? "long" : "short"}">${p.isLong ? "Long" : "Short"} ${lev.toFixed(1)}×</td>
        <td>${money(toUsd(p.size))}</td><td>${pxFmt(toPx(p.entryPrice))}</td><td>${pxFmt(toPx(p.mark))}</td><td class="${p.liquidatable ? "short" : ""}">${pxFmt(toPx(p.liqPrice))}</td>
        <td>${money(toUsd(p.margin))}</td><td class="${pnl >= 0 ? "long" : "short"}">${money(pnl)} <span class="faint">(${pct(roe)})</span></td>
        ${withActions ? `<td><div class="row" style="flex-wrap:nowrap;gap:6px"><button class="btn btn--xs btn--ghost" data-add="${p.id}">Add margin</button><button class="btn btn--xs" data-close="${p.id}">Close</button></div>
          <div class="row" data-addform="${p.id}" hidden style="margin-top:8px;flex-wrap:nowrap"><div class="amount" style="height:34px;padding:0 8px"><input id="add-${p.id}" inputmode="decimal" placeholder="USDG" style="height:32px;font-size:14px;width:90px" aria-label="Margin to add"></div><button class="btn btn--xs btn--amber" data-addgo="${p.id}">Add</button></div></td>` : ""}
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function bindPositions(host, refresh) {
    $$("[data-connect]", host).forEach((b) => (b.onclick = connect));
    $$("[data-close]", host).forEach((b) => (b.onclick = async () => { b.disabled = true; if (await run("Closing position…", (st) => state.be.close(Number(b.dataset.close), st))) { await refresh(); wallet(); } else b.disabled = false; }));
    $$("[data-add]", host).forEach((b) => (b.onclick = () => { const f = $(`[data-addform="${b.dataset.add}"]`, host); f.hidden = !f.hidden; if (!f.hidden) $("input", f).focus(); }));
    $$("[data-addgo]", host).forEach((b) => (b.onclick = async () => {
      const amt = parseUnits($(`#add-${b.dataset.addgo}`).value);
      if (!amt) { toast("err", "Enter an amount", "How much USDG to add as margin."); return; }
      if (await run("Adding margin…", (st) => state.be.addMargin(Number(b.dataset.addgo), amt, st))) { await refresh(); wallet(); }
    }));
  }

  views.trade = async (params, sym) => {
    await loadMarkets();
    const m = state.markets.find((x) => x.symbol === String(sym).toUpperCase());
    if (!m) { views.notfound(); return; }
    const p = state.params;
    let side = params.get("side") === "short" ? "short" : "long";
    let lev = Math.min(m.maxLeverage, Number(ls.get("ln-lev")) || 5);
    main.innerHTML = `<section class="page"><div class="wrap">
      <nav class="strip" aria-label="Markets">${state.markets.map((x) => `<a href="#/trade/${esc(x.symbol)}" class="${x.id === m.id ? "is-on" : ""}"><b>${esc(x.symbol)}</b><span data-strip="${x.id}">${pxFmt(toPx(x.price))}</span></a>`).join("")}</nav>
      <div class="tradehead">${badge(m)}<div><h1>${esc(m.symbol)}</h1><div class="muted small">${esc(m.name)} · ${esc(m.sector)}</div></div>
        <div class="tradehead__px"><div class="big" id="tPx">${pxFmt(toPx(m.price))}</div><div class="mono small"><span id="tCh"></span> · <span class="faint" id="tUpd"></span></div></div></div>
      <div class="tgrid">
        <div>
          <div class="panel">
            <div class="chartbar"><div class="seg seg--sm" id="tf" role="group" aria-label="Timeframe"><button type="button" data-r="3600">1h</button><button type="button" data-r="21600">6h</button><button type="button" data-r="86400" class="on">24h</button></div><span class="faint small">Drag across the chart to measure · double-click to clear</span></div>
            <div class="chart" id="chart"></div>
            <div class="lsbar" id="lsbar" aria-label="Open interest, long versus short"><div class="lsbar__track"><i class="lsbar__long"></i><i class="lsbar__short"></i></div><div class="lsbar__legend"><span class="long" id="lsL"></span><span class="faint">Open interest</span><span class="short" id="lsS"></span></div></div>
          </div>
          <div class="panel"><div class="head" style="margin-bottom:12px"><span class="label">Your positions</span><span class="faint small" id="posNote"></span></div><div id="positions"></div></div>
        </div>
        <form class="panel" id="order" novalidate>
          <div class="seg" id="side"><button type="button" data-s="long">Long</button><button type="button" data-s="short">Short</button></div>
          <div class="field"><div class="fieldhead"><label class="label" for="margin">Margin</label><span class="faint small" id="bal"></span></div>
            <div class="amount"><input id="margin" inputmode="decimal" placeholder="0.00" autocomplete="off"><span>USDG</span></div></div>
          <div class="field"><div class="fieldhead"><label class="label" for="lev">Leverage</label><span class="mono" id="levV"></span></div>
            <input type="range" class="lev" id="lev" min="1" max="${m.maxLeverage}" step="1" value="${lev}">
            <div class="levticks">${[1, 2, 3, 5, m.maxLeverage].filter((v, i, a) => a.indexOf(v) === i).map((v) => `<button type="button" data-l="${v}">${v}×</button>`).join("")}</div></div>
          <dl class="summary" id="sum"></dl>
          <div class="whatif" id="whatif"><div class="fieldhead"><label class="label" for="wi">What if the price moves</label><b class="mono" id="wiV">+0.0%</b></div>
            <input type="range" class="lev" id="wi" min="-20" max="20" step="0.5" value="0" aria-describedby="wiOut"><div class="levticks"><span>−20%</span><span>0</span><span>+20%</span></div>
            <p class="whatif__out" id="wiOut">Enter margin to simulate.</p></div>
          <button class="btn btn--block" id="go" type="submit" style="height:52px"></button>
          ${state.be.canFaucet ? `<button class="btn btn--ghost btn--block btn--sm" id="faucet" type="button" style="margin-top:10px">Get 5,000 test USDG</button>` : ""}
          <p class="faint small" style="margin:14px 0 0"><button type="button" class="linkbtn" id="kbdHelp">Keyboard shortcuts</button> · Liquidation happens when equity falls below ${Number(p?.maintenanceBps ?? 500n) / 100}% of position size. Fees: ${Number(p?.feeBps ?? 10n) / 100}% on open and on close.</p>
        </form>
      </div>
    </div></section>`;

    let hist = await loadHist(m.id, true);
    if (!$("#chart")) return;
    const fmt = { axis: (v) => pxFmt(v), value: (v) => pxFmt(v), time: (t) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), full: (t) => new Date(t * 1000).toLocaleString() };
    const ch = chart($("#chart"), hist, fmt);
    $$("#tf button").forEach((b) => (b.onclick = () => { $$("#tf button").forEach((x) => x.classList.toggle("on", x === b)); ch.setRange(Number(b.dataset.r)); }));
    function lsbar() {
      const cur = state.markets[m.id]; if (!$("#lsbar")) return;
      const l = toUsd(cur.longNotional), sh = toUsd(cur.shortNotional), tot = l + sh;
      const lp = tot ? (l / tot) * 100 : 50;
      $(".lsbar__long").style.width = `${lp}%`; $(".lsbar__short").style.width = `${100 - lp}%`;
      if (!tot) { $("#lsL").textContent = ""; $("#lsS").textContent = ""; $("#lsbar .lsbar__legend .faint").textContent = "No open interest yet"; return; }
      $("#lsbar .lsbar__legend .faint").textContent = "Open interest";
      $("#lsL").textContent = `Long ${lp.toFixed(0)}% · ${compact(l)}`; $("#lsS").textContent = `${compact(sh)} · ${(100 - lp).toFixed(0)}% Short`;
    }
    let positions = [];

    async function refreshPositions() {
      try { positions = await state.be.positions(); } catch (e) { console.warn(e); positions = []; }
      if (!$("#positions")) return;
      $("#positions").innerHTML = positionsTable(positions);
      $("#posNote").textContent = positions.length ? `${positions.length} open` : "";
      bindPositions($("#positions"), refreshPositions);
      ch.setEntries(positions.filter((x) => x.marketId === m.id).flatMap((x) => [{ v: toPx(x.entryPrice), color: cssv("--ink-3"), label: `Entry ${x.isLong ? "long" : "short"}` }, { v: toPx(x.liqPrice), color: cssv("--short"), label: "Liquidation" }]).filter((e) => e.v > 0));
    }
    let bal = null;
    async function refreshBal() { try { bal = await state.be.balance(); } catch { bal = null; } if (!$("#bal")) return; ($("#bal").innerHTML = bal === null ? "" : `Balance ${money(toUsd(bal))} <button type="button" class="linkbtn" id="max">Max</button>`); if ($("#max")) $("#max").onclick = () => { $("#margin").value = toUsd(bal).toFixed(2); summary(); }; summary(); }

    function head() {
      const cur = state.markets[m.id];
      $("#tPx").textContent = pxFmt(toPx(cur.price));
      const c = change24(m.id); $("#tCh").textContent = `${pct(c)} 24h`; $("#tCh").className = c >= 0 ? "long" : "short";
      $("#tUpd").textContent = `price ${ago(cur.updatedAt)}`;
      state.markets.forEach((x) => { const e = $(`[data-strip="${x.id}"]`); if (e) e.textContent = pxFmt(toPx(x.price)); });
    }
    function summary() {
      if (!$("#sum")) return;
      const cur = state.markets[m.id];
      $$("#side button").forEach((b) => (b.className = b.dataset.s === side ? `on-${side}` : ""));
      $("#levV").textContent = `${lev}×`;
      $$(".levticks button").forEach((b) => b.classList.toggle("on", Number(b.dataset.l) === lev));
      const margin = parseUnits($("#margin").value) || 0n;
      const L = BigInt(lev), feeBps = p?.feeBps ?? 10n, maint = p?.maintenanceBps ?? 500n;
      const fee = (margin * L * feeBps) / BPS, net = margin - fee, size = net * L;
      const e = cur.price;
      let liq = 0n;
      if (size > 0n) { const k = (((size * maint) / BPS - net) * e) / size; liq = side === "long" ? e + k : e - k; if (liq < 0n) liq = 0n; }
      $("#sum").innerHTML = [["Position size", money(toUsd(size))], ["Entry price (now)", pxFmt(toPx(e))], ["Liquidation price", size > 0n ? pxFmt(toPx(liq)) : "—"], ["Opening fee", money(toUsd(fee))]].map(([a, b2]) => `<div><dt>${a}</dt><dd>${b2}</dd></div>`).join("");
      const mv = Number($("#wi").value);
      $("#wiV").textContent = `${mv >= 0 ? "+" : "−"}${Math.abs(mv).toFixed(1)}%`;
      if (size > 0n) {
        const sz = toUsd(size), nt = toUsd(net), dir = side === "long" ? 1 : -1;
        const pnl = sz * (mv / 100) * dir, eq = nt + pnl, maintV = sz * Number(maint) / 10000;
        const closeFee = sz * Number(feeBps) / 10000, back = Math.max(0, eq - closeFee);
        const liqd = eq < maintV;
        $("#wiOut").innerHTML = liqd ? `<span class="short">Liquidated.</span> A ${Math.abs(mv).toFixed(1)}% move ${mv * dir < 0 ? "against you" : ""} wipes out this position's margin.` :
          `<span class="${pnl >= 0 ? "long" : "short"}">${money(pnl)}</span> (${pct((pnl / toUsd(margin)) * 100)} on margin). You'd get back about ${money(back)} after the closing fee.`;
        $("#whatif").classList.toggle("is-liq", liqd);
      } else { $("#wiOut").textContent = "Enter margin to simulate."; $("#whatif").classList.remove("is-liq"); }
      const go = $("#go");
      go.className = `btn btn--block ${side === "long" ? "btn--jade" : "btn--cinnabar"}`;
      go.disabled = false;
      if (!state.be.account) { go.textContent = "Connect wallet"; go.dataset.act = "connect"; return; }
      go.dataset.act = "open";
      const min = p?.minMargin ?? 5_000_000n;
      if (!margin) { go.textContent = "Enter margin"; go.disabled = true; }
      else if (bal !== null && margin > bal) { go.textContent = "Insufficient USDG"; go.disabled = true; }
      else if (margin < min) { go.textContent = `Minimum ${money(toUsd(min))}`; go.disabled = true; }
      else go.textContent = `${side === "long" ? "Long" : "Short"} ${m.symbol} · ${lev}×`;
    }

    $$("#side button").forEach((b) => (b.onclick = () => { side = b.dataset.s; summary(); }));
    $("#lev").oninput = (e) => { lev = Number(e.target.value); ls.set("ln-lev", String(lev)); summary(); };
    $$(".levticks button").forEach((b) => (b.onclick = () => { lev = Number(b.dataset.l); $("#lev").value = lev; ls.set("ln-lev", String(lev)); summary(); }));
    $("#margin").oninput = (e) => { const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); if (v !== e.target.value) e.target.value = v; summary(); };
    if ($("#faucet")) $("#faucet").onclick = async () => { if (!state.be.account && !(await connect())) return; if (await run("Minting test USDG…", () => state.be.faucet())) { refreshBal(); wallet(); } };
    $("#order").addEventListener("submit", async (e) => {
      e.preventDefault();
      const go = $("#go");
      if (go.dataset.act === "connect") { await connect(); return; }
      const margin = parseUnits($("#margin").value);
      if (!margin) return;
      go.disabled = true;
      const ok = await run(`Opening ${side} ${m.symbol}…`, (st) => state.be.open(m.id, side === "long", margin, lev, st));
      if (ok) { if ($("#margin")) $("#margin").value = ""; await loadMarkets(); await Promise.all([refreshPositions(), refreshBal()]); wallet(); }
      summary();
    });
    const onWallet = () => { if ($("#order")) { refreshBal(); refreshPositions(); } };
    document.addEventListener("ln:wallet", onWallet);
    $("#wi").oninput = summary;
    $("#kbdHelp").onclick = shortcuts;
    // keyboard shortcuts on the trade screen
    const keys = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.querySelector(".cmdk")) return;
      const k = e.key.toLowerCase();
      if (k === "l" || k === "s") { side = k === "l" ? "long" : "short"; summary(); }
      else if (/^[0-9]$/.test(k)) { const v = k === "0" ? 10 : Number(k); lev = Math.min(m.maxLeverage, v); $("#lev").value = lev; ls.set("ln-lev", String(lev)); summary(); }
      else if (k === "m") { e.preventDefault(); $("#margin").focus(); }
      else if (k === "?") { e.preventDefault(); shortcuts(); }
      else if (k === "arrowright" || k === "arrowleft") { const i = (m.id + (k === "arrowright" ? 1 : state.markets.length - 1)) % state.markets.length; location.hash = `#/trade/${state.markets[i].symbol}`; }
      else return;
    };
    document.addEventListener("keydown", keys);
    viewCleanup = () => { document.removeEventListener("ln:wallet", onWallet); document.removeEventListener("keydown", keys); $(".shortcuts")?.remove(); };

    head(); summary(); refreshBal(); refreshPositions(); lsbar();
    let lastUpd = state.markets[m.id].updatedAt;
    onTick(async () => {
      if (!$("#chart")) return;
      head(); lsbar();
      const upd = state.markets[m.id].updatedAt;
      if (state.be.demo || upd !== lastUpd) { lastUpd = upd; hist = await loadHist(m.id, true); if (!$("#chart")) return; ch.update(hist); }
      summary();
      if (positions.length || state.be.demo) refreshPositions();
      refreshBal();
    });
  };

  views.portfolio = async () => {
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="head"><div><span class="kicker">Portfolio</span><h1 class="h2">Your book</h1></div></div>
      <div class="stats" id="pStats">${["Wallet", "Margin in positions", "Unrealised PnL", "Account value"].map((k) => `<div class="stat"><span class="label">${k}</span><div class="stat__v">—</div></div>`).join("")}</div>
      <div class="panel" style="margin-top:14px"><span class="label">Open positions</span><div id="positions" style="margin-top:12px"></div></div>
      <div class="panel"><span class="label">Recently closed</span><div id="closed" style="margin-top:12px"></div></div>
    </div></section>`;
    await loadMarkets();
    async function refresh() {
      if (!$("#positions")) return;
      let pos = [], closed = [], bal = null;
      try { [pos, closed, bal] = await Promise.all([state.be.positions(), state.be.closed(), state.be.balance()]); } catch (e) { console.warn(e); }
      if (!$("#positions")) return;
      const margin = pos.reduce((a, p) => a + toUsd(p.margin), 0), pnl = pos.reduce((a, p) => a + toUsd(p.pnl), 0), w = toUsd(bal);
      const vals = state.be.account ? [money(w), money(margin), money(pnl), money(w + margin + pnl)] : ["—", "—", "—", "—"];
      $$("#pStats .stat__v").forEach((el, i) => { el.textContent = vals[i]; if (i === 2) el.className = `stat__v ${pnl >= 0 ? "long" : "short"}`; });
      $("#positions").innerHTML = positionsTable(pos);
      bindPositions($("#positions"), refresh);
      $("#closed").innerHTML = !state.be.account ? `<div class="empty"><p>Connect a wallet to see your history.</p></div>` : !closed.length ? `<div class="empty"><p>Nothing closed yet.</p></div>` :
        `<div class="table-wrap"><table class="table"><thead><tr><th>Market</th><th>Result</th><th>Exit</th><th>PnL</th><th>Paid out</th><th>When</th></tr></thead><tbody>${closed.slice(0, 25).map((c) => {
          const m = c.marketId !== null && c.marketId !== undefined ? state.markets[c.marketId] : null;
          const link = c.tx ? state.be.explorerTx(c.tx) : null;
          const when = c.closedAt ? ago(c.closedAt) : link ? `<a href="${esc(link)}" target="_blank" rel="noopener">block ${c.block}</a>` : `block ${c.block}`;
          return `<tr><td><b>${esc(m?.symbol || "—")}</b></td><td class="${c.liquidated ? "short" : ""}">${c.liquidated ? "Liquidated" : "Closed"}</td><td>${pxFmt(toPx(c.exit))}</td><td class="${c.pnl !== null && toUsd(c.pnl) >= 0 ? "long" : "short"}">${c.pnl === null ? "—" : money(toUsd(c.pnl))}</td><td>${money(toUsd(c.payout))}</td><td class="faint">${when}</td></tr>`;
        }).join("")}</tbody></table></div>`;
    }
    const onWallet = () => refresh();
    document.addEventListener("ln:wallet", onWallet);
    viewCleanup = () => document.removeEventListener("ln:wallet", onWallet);
    await refresh();
    onTick(refresh);
  };

  views.vault = async () => {
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="head"><div><span class="kicker">Liquidity vault</span><h1 class="h2">Be the house.</h1><p class="lead" style="margin-top:14px">The vault takes the other side of every trade. It earns all trading fees and every trader loss, and it pays every trader profit. Its share price moves with that result.</p></div></div>
      <div class="stats" id="vStats">${["Vault assets", "Share price", "Net exposure", "Your position"].map((k) => `<div class="stat"><span class="label">${k}</span><div class="stat__v">—</div><div class="stat__s"></div></div>`).join("")}</div>
      <div class="panel" style="margin-top:14px"><div class="fieldhead"><span class="label">Exposure used</span><span class="mono small" id="expV"></span></div><div class="risk-bar" style="margin-top:10px"><i id="expBar" style="width:0"></i></div><p class="faint small" style="margin:10px 0 0">New positions are refused when net exposure would pass the cap, and withdrawals are refused when they would leave open positions uncovered.</p></div>
      <div class="two" style="margin-top:14px">
        <form class="panel" id="dep" novalidate><span class="label">Deposit</span><div class="field"><div class="fieldhead"><label class="faint small" for="depAmt">USDG</label><span class="faint small" id="depBal"></span></div><div class="amount"><input id="depAmt" inputmode="decimal" placeholder="0.00"><span>USDG</span></div></div><button class="btn btn--amber btn--block" style="margin-top:16px" type="submit">Deposit</button></form>
        <form class="panel" id="wd" novalidate><span class="label">Withdraw</span><div class="field"><div class="fieldhead"><label class="faint small" for="wdAmt">Shares (LNV)</label><span class="faint small" id="wdBal"></span></div><div class="amount"><input id="wdAmt" inputmode="decimal" placeholder="0.00"><span>LNV</span></div></div><button class="btn btn--ghost btn--block" style="margin-top:16px" type="submit">Withdraw</button></form>
      </div>
      <p class="note" style="margin-top:24px">Vault depositors lose money when traders win. The share price only counts closed results, so it can jump when large positions close.</p>
    </div></section>`;
    await loadMarkets();
    const SH = 10n ** 18n; // demo shares use collateral units; chain shares use 18 decimals
    let v = null;
    const shareDec = () => (state.be.demo ? dec() : 18);
    async function refresh() {
      if (!$("#vStats")) return;
      try { v = await state.be.vault(); } catch (e) { console.warn(e); return; }
      if (!$("#vStats")) return;
      const assets = toUsd(v.assets), supply = Number(v.supply) / 10 ** shareDec();
      const sp = supply ? assets / supply : 1, mine = v.mine === null ? null : Number(v.mine) / 10 ** shareDec();
      const cap = Number(state.params?.maxNetExposureBps ?? 5000n) / 10000;
      const used = assets ? toUsd(v.net) / (assets * cap) : 0;
      const vals = [[money(assets), "USDG"], [`$${sp.toFixed(4)}`, "per LNV share"], [money(toUsd(v.net)), `cap ${money(assets * cap)}`], [mine === null ? "—" : money(mine * sp), mine === null ? "connect to see" : `${mine.toLocaleString("en-US", { maximumFractionDigits: 2 })} LNV`]];
      $$("#vStats .stat").forEach((s, i) => { $(".stat__v", s).textContent = vals[i][0]; $(".stat__s", s).textContent = vals[i][1]; });
      $("#expBar").style.width = `${Math.min(100, used * 100).toFixed(1)}%`;
      $("#expV").textContent = `${(used * 100).toFixed(1)}%`;
      const bal = await state.be.balance().catch(() => null);
      if (!$("#depBal")) return;
      $("#depBal").textContent = bal === null ? "" : `Wallet ${money(toUsd(bal))}`;
      $("#wdBal").innerHTML = mine === null ? "" : `You hold ${mine.toLocaleString("en-US", { maximumFractionDigits: 4 })} <button type="button" class="linkbtn" id="wdMax">Max</button>`;
      if ($("#wdMax")) $("#wdMax").onclick = () => { $("#wdAmt").value = ethers.formatUnits(v.mine, shareDec()); $("#wdAmt").dataset.exact = v.mine.toString(); };
    }
    $("#wdAmt").addEventListener("input", (e) => delete e.target.dataset.exact);
    $("#dep").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.be.account && !(await connect())) return;
      const a = parseUnits($("#depAmt").value);
      if (!a) { toast("err", "Enter an amount", "How much USDG to deposit."); return; }
      if (await run("Depositing…", (st) => state.be.deposit(a, st))) { if ($("#depAmt")) $("#depAmt").value = ""; refresh(); wallet(); }
    });
    $("#wd").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.be.account && !(await connect())) return;
      const el = $("#wdAmt");
      let s = null;
      if (el.dataset.exact) s = BigInt(el.dataset.exact);
      else { try { s = el.value ? ethers.parseUnits(el.value.trim(), shareDec()) : null; } catch { s = null; } }
      if (!s) { toast("err", "Enter an amount", "How many shares to withdraw."); return; }
      if (await run("Withdrawing…", (st) => state.be.withdraw(s, st))) { el.value = ""; delete el.dataset.exact; refresh(); wallet(); }
    });
    const onWallet = () => refresh();
    document.addEventListener("ln:wallet", onWallet);
    viewCleanup = () => document.removeEventListener("ln:wallet", onWallet);
    void SH;
    await refresh();
    onTick(refresh);
  };

  const prose = (kicker, title, html) => { main.innerHTML = `<section class="page"><div class="wrap"><span class="kicker">${kicker}</span><h1 class="h2" style="margin-bottom:28px">${title}</h1><article class="prose">${html}</article></div></section>`; };

  views.learn = () => prose("Learn", "How Lantern works", `
    <p>Lantern lets you take a leveraged long or short position on the price of eight Chinese companies listed in the United States. You post USDG as margin. You never hold the shares; your position only tracks the price.</p>
    <h2>Opening a position</h2>
    <p>Choose a market, a side and a leverage between 1× and 10×. The opening fee is 0.1% of the position size, taken from your margin. What is left is your margin, and the position size is that margin times your leverage.</p>
    <div class="formula">fee  = margin × leverage × 0.1%<br>size = (margin − fee) × leverage</div>
    <h2>Profit and loss</h2>
    <div class="formula">long PnL  = size × (price − entry) ÷ entry<br>short PnL = size × (entry − price) ÷ entry</div>
    <p>Closing charges another 0.1% of size. You receive margin + PnL − fee, never less than zero.</p>
    <h2>Liquidation</h2>
    <p>If your equity (margin + PnL) falls below 5% of the position size, anyone can liquidate the position. The liquidator receives up to 0.5% of size from what remains, and the rest goes to the vault. At 10× leverage a move of about 5% against you is enough. Adding margin moves your liquidation price away.</p>
    <h2>Prices</h2>
    <p>Prices come from an on-chain oracle that authorised keepers update. The exchange refuses to trade on a price older than one hour, and a single update can't move a price more than 20%. Outside US market hours the oracle holds the last price, so positions can gap when trading resumes.</p>
    <h2>The vault</h2>
    <p>Liquidity providers deposit USDG into the vault and receive LNV shares. The vault is the counterparty to every trade. Total net exposure across markets is capped at 50% of vault assets.</p>
    <h2>Contracts</h2>
    <p><code>PriceOracle.sol</code> stores keeper prices, and <code>LanternExchange.sol</code> holds margin, positions and the vault. Both are MIT licensed, tested, and not yet audited.</p>`);

  views.risk = () => prose("Risk disclosure", "Read this before trading", `
    <p><b>Leverage multiplies losses.</b> At 10× a 10% move against you wipes out your margin. Liquidation can happen quickly, especially when prices gap after a market closure.</p>
    <h3>No ownership, no affiliation</h3><p>Positions are synthetic. You have no rights to the shares, dividends or votes. Lantern is not affiliated with, endorsed by, or a broker for any listed company.</p>
    <h3>Oracle risk</h3><p>Prices come from keepers. A delayed, wrong or manipulated price can cause unfair liquidations or payouts.</p>
    <h3>Counterparty and vault risk</h3><p>Profits are paid from the vault. In extreme cases the vault can run out, and payouts are capped at what it holds.</p>
    <h3>Smart-contract risk</h3><p>The contracts are tested but not formally audited. Bugs could lead to loss of funds.</p>
    <h3>Legal</h3><p>Leveraged products that reference equities are regulated or prohibited in many countries. Make sure you are allowed to use this where you live. Nothing here is investment advice.</p>`);

  views.notfound = () => { main.innerHTML = `<section class="page"><div class="wrap"><div class="empty"><h1 class="h2">Nothing here</h1><p>That page doesn't exist.</p><a class="btn" href="#/">Home</a></div></div></section>`; };

  // ───────────────────────── router ─────────────────────────
  let viewCleanup = null;
  function route() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    let view = "home", arg;
    if (!parts.length) view = "home";
    else if (parts[0] === "trade" && parts[1]) { view = "trade"; arg = parts[1]; }
    else if (parts[0] === "trade") { view = "trade"; arg = "BABA"; }
    else if (["markets", "portfolio", "vault", "tools", "zcash", "learn", "risk"].includes(parts[0])) view = parts[0];
    else view = "notfound";
    if (viewCleanup) { viewCleanup(); viewCleanup = null; }
    viewTick = null;
    clearInterval(clockTimer);
    $$("[data-nav]").forEach((a) => a.classList.toggle("is-on", a.dataset.nav === view || (view === "trade" && a.dataset.nav === "markets")));
    $("#nav").classList.remove("is-open"); $("#burger").setAttribute("aria-expanded", "false");
    window.scrollTo(0, 0);
    document.title = `Lantern — ${{ home: "the night desk for China's giants", markets: "Markets", trade: `${String(arg).toUpperCase()}`, portfolio: "Portfolio", vault: "Vault", tools: "Tools", zcash: "Zcash corner", learn: "How it works", risk: "Risk disclosure", notfound: "Not found" }[view]}`;
    Promise.resolve(views[view](params, arg)).catch((e) => { console.error(e); toast("err", "Something broke", B.friendly(e)); });
  }

  // ───────────────────────── chrome ─────────────────────────
  const nav = $("#nav");
  new ResizeObserver(() => document.documentElement.style.setProperty("--navh", `${nav.offsetHeight}px`)).observe(nav);
  addEventListener("scroll", () => nav.classList.toggle("is-scrolled", scrollY > 8), { passive: true });
  $("#burger").onclick = () => { const o = !nav.classList.contains("is-open"); nav.classList.toggle("is-open", o); $("#burger").setAttribute("aria-expanded", String(o)); };
  const nets = B.networks();
  $$(".net").forEach((s) => {
    s.innerHTML = nets.map((n) => `<option value="${esc(n.key)}">${esc(n.name)}</option>`).join("");
    s.onchange = () => { setNet(nets.find((n) => n.key === s.value)); startFeed(); };
  });
  $("#year").textContent = new Date().getFullYear();
  addEventListener("hashchange", route);

  const saved = nets.find((n) => n.key === ls.get("ln-net"));
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const firstLive = nets.find((n) => !n.demo && (n.chainId !== 31337 || isLocal));
  setNet(saved && (saved.demo || saved.chainId !== 31337 || isLocal) ? saved : firstLive || nets.find((n) => n.demo), true);
  startFeed();
  route();

  state.sky = window.LN_SKY.init();

  // live price ticker under the nav
  const prevPx = new Map();
  function renderTicker() {
    const tr = $("#tickerTrack");
    if (!tr || !state.markets.length) return;
    const items = state.markets.map((m) => {
      const c = change24(m.id), p = toPx(m.price), was = prevPx.get(m.id);
      const arrow = was === undefined || was === p ? "" : p > was ? "▲" : "▼";
      prevPx.set(m.id, p);
      return `<a href="#/trade/${esc(m.symbol)}"><b>${esc(m.symbol)}</b>${pxFmt(p)}<span class="${c >= 0 ? "long" : "short"}">${arrow} ${pct(c)}</span></a>`;
    }).join("");
    tr.innerHTML = items + items.replace(/<a /g, '<a tabindex="-1" aria-hidden="true" ');
  }

  // guided tour (runs on first visit to the home page, or from the footer link)
  function tour() {
    if (location.hash && location.hash !== "#/") { location.hash = "#/"; setTimeout(tour, 900); return; }
    const steps = [
      ["#plateWrap", "Spin the plate", "Each ring is one market's last 24 hours. Drag to spin it, and click a ring to open that market."],
      ["#board", "The market board", "Live prices, 24h change and a mini chart. Star a market to add it to your watchlist, or go long or short straight from a row."],
      ["#heat", "Heatmap", "Tile colour shows the 24h move and tile size shows open interest. Click any tile to trade it."],
      ["#tlHome", "Exchange clock", "See when New York, Hong Kong and Shanghai are open, in your local time. Drag the red needle through the day."],
      ["#cmdkBtn", "Jump anywhere", "Press Ctrl+K or / to search every market and page. On a trade screen, press ? for its keyboard shortcuts."],
      ['a[data-nav="zcash"]', "Zcash corner", "Interactive explainers on how Zcash hides payments, plus its supply and halving schedule."],
    ];
    let i = 0;
    const hole = document.createElement("div"); hole.className = "tour-hole";
    const card = document.createElement("div"); card.className = "tour-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Guided tour");
    document.body.append(hole, card);
    const end = () => { hole.remove(); card.remove(); removeEventListener("keydown", key); try { localStorage.setItem("ln-toured", "1"); } catch { /* ignore */ } };
    const key = (e) => { if (e.key === "Escape") end(); else if (e.key === "ArrowRight") show(i + 1); else if (e.key === "ArrowLeft") show(i - 1); };
    addEventListener("keydown", key);
    function show(n) {
      if (n < 0) return;
      if (n >= steps.length) { end(); return; }
      i = n;
      const [sel, title, body] = steps[i];
      let el = $(sel);
      if (!el || !el.getClientRects().length) { el = $("#burger"); }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        const r = el.getBoundingClientRect(), pad = 8;
        Object.assign(hole.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        card.innerHTML = `<span class="label">Step ${i + 1} of ${steps.length}</span><h3>${title}</h3><p>${body}</p><div class="row" style="justify-content:space-between"><button class="btn btn--xs btn--ghost" data-t="skip">Skip tour</button><div class="row" style="gap:6px">${i ? '<button class="btn btn--xs btn--ghost" data-t="back">Back</button>' : ""}<button class="btn btn--xs btn--amber" data-t="next">${i === steps.length - 1 ? "Finish" : "Next"}</button></div></div>`;
        const below = r.bottom + 16 + 200 < innerHeight;
        const top = below ? r.bottom + 16 : Math.max(16, r.top - card.offsetHeight - 16);
        card.style.top = `${top}px`; card.style.left = `${Math.min(Math.max(16, r.left), innerWidth - card.offsetWidth - 16)}px`;
        card.querySelector('[data-t="next"]').onclick = () => show(i + 1);
        card.querySelector('[data-t="skip"]').onclick = end;
        const back = card.querySelector('[data-t="back"]'); if (back) back.onclick = () => show(i - 1);
        card.querySelector('[data-t="next"]').focus();
      }, 420);
    }
    show(0);
  }
  $("#tourBtn") && ($("#tourBtn").onclick = tour);
  window.LN_TOUR = tour;
  function updateWeather() {
    const ch = state.markets.map((m) => change24(m.id)).filter(isFinite);
    if (!ch.length) return;
    const avg = ch.reduce((a, b) => a + b, 0) / ch.length;
    state.sky.setMood(avg);
    const label = avg <= -1.5 ? "Storm" : avg < -0.3 ? "Rain" : avg < 0.3 ? "Overcast" : avg < 1.5 ? "Breaking cloud" : "Sun through cloud";
    const icon = avg < -0.3 ? '<path d="M7 17a4 4 0 1 1 1-7.9A5 5 0 0 1 18 10a3.5 3.5 0 0 1-1 7z"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2"/>' : avg < 0.3 ? '<path d="M7 18a4 4 0 1 1 1-7.9A5 5 0 0 1 18 11a3.5 3.5 0 0 1-1 7z"/>' : '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M1 8h2M3 3l1.4 1.4M13 3l-1.4 1.4"/><path d="M9 19a4 4 0 1 1 1-7.9A5 5 0 0 1 20 12a3.5 3.5 0 0 1-1 7z"/>';
    $$("[data-weather]").forEach((el) => { el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${icon}</svg>${label} · markets ${pct(avg)} avg`; el.title = "The sky follows the average 24h change across all eight markets."; });
  }
  window.LN_TOOLS.initTheme();
  window.LN_TOOLS.initPalette(() => state.markets);
  (state.markets.length ? Promise.resolve() : loadMarkets()).then(async () => {
    await Promise.all(state.markets.map((m) => loadHist(m.id)));
    renderTicker(); updateWeather();
    let toured = null; try { toured = localStorage.getItem("ln-toured"); } catch { toured = "1"; }
    if (!toured && (!location.hash || location.hash === "#/") && !navigator.webdriver) setTimeout(() => { if ($("#board")) toast("ok", "New here?", "Take the 30-second tour from the footer, or press T.", 7000); }, 1500);
  });
  document.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") && !$(".tour-card") && !$(".cmdk") && !location.hash.startsWith("#/trade")) tour(); });
  document.addEventListener("ln:theme", () => { if (viewTick) viewTick(); });

  window.LN_APP = { state, route };
})();
