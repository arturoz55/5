// Tensorforge — app shell, router and views
(function () {
  const { ethers } = window;
  const CFG = window.TF_CONFIG;
  const FX = window.TF_FX;
  const B = window.TF_BACKEND;
  const ZERO = B.ZERO;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const main = $("#main");

  // ───────────────────────────── utils ─────────────────────────────
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => {
    try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; }
  };
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
  const toNum = (wei) => Number(ethers.formatUnits(wei, 18));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  function fmtCompact(n, digits = 2) {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(digits) + "T";
    if (a >= 1e9) return (n / 1e9).toFixed(digits) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(digits) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(digits) + "K";
    if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: digits });
    if (a === 0) return "0";
    return fmtPrice(n);
  }
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function fmtPrice(n) {
    if (!isFinite(n)) return "—";
    if (n === 0) return "0";
    const a = Math.abs(n);
    if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    if (a >= 0.0001) return n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
    // 0.0000001234 -> 0.0₆1234
    const zeros = Math.floor(-Math.log10(a)) - 1;
    const digits = Math.round(a * Math.pow(10, zeros + 4)).toString().slice(0, 4).replace(/0+$/, "");
    const sub = String(zeros).split("").map((d) => SUB[d]).join("");
    return `${n < 0 ? "-" : ""}0.0${sub}${digits || "0"}`;
  }
  const fmtUsd = (n) => (!isFinite(n) ? "—" : n >= 1 ? "$" + fmtCompact(n) : "$" + fmtPrice(n));
  const pct = (n) => (!isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
  function ago(ts) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function parseAmount(str, decimals = 18) {
    const s = String(str || "").trim().replace(/,/g, "");
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
    const [i, f = ""] = s.split(".");
    try { return ethers.parseUnits(`${i || "0"}.${f.slice(0, decimals) || "0"}`, decimals); } catch { return null; }
  }
  const trimNum = (wei, dp = 6) => {
    const s = ethers.formatUnits(wei, 18);
    const [i, f = ""] = s.split(".");
    const ff = f.slice(0, dp).replace(/0+$/, "");
    return ff ? `${i}.${ff}` : i;
  };

  // ───────────────────────────── state ─────────────────────────────
  const state = {
    net: null, be: null, taoUsd: null, taoChange: null, taoSeries: null,
    launches: null, launchesErr: null, swaps: new Map(), quoteSyms: new Map([[ZERO, "TAO"]]),
  };

  const priceOf = (l) => (l.reserveToken > 0n ? toNum(l.reserveQuote) / toNum(l.reserveToken) : 0);
  const mcapOf = (l) => priceOf(l) * toNum(l.totalSupply);
  const qsym = (l) => state.quoteSyms.get(l.quote) || "α";
  const isNative = (l) => l.quote === ZERO;
  const usdOf = (l, v) => (isNative(l) && state.taoUsd ? v * state.taoUsd : NaN);
  const kindOf = (l) => (["Subnet Coin", "Subnet Candidate"].includes(l.meta.kind) ? l.meta.kind : "Token");
  const sectorOf = (l) => (CFG.sectors.find((s) => s.key === l.meta.sector) ? l.meta.sector : "other");
  const sectorLabel = (k) => (CFG.sectors.find((s) => s.key === k) || { label: "Other" }).label;

  function seriesOf(l) {
    const sw = state.swaps.get(l.pool);
    if (!sw) return null;
    const pts = sw.map((s) => ({ t: s.ts, v: toNum(s.reserveQuote) / toNum(s.reserveToken) }));
    const first = sw[0];
    if (first && first.ts - l.createdAt < 90 * 86400) {
      // rewind the first trade to recover the launch price (fee split per ForgePool)
      let rq, rt;
      if (first.isBuy) { rt = first.reserveToken + first.tokenAmount; rq = first.reserveQuote - (first.quoteAmount - (first.quoteAmount * 50n) / 10000n); }
      else { const gross = (first.quoteAmount * 100n) / 99n; rt = first.reserveToken - first.tokenAmount; rq = first.reserveQuote + first.quoteAmount + (gross * 50n) / 10000n; }
      if (rt > 0n && rq > 0n) pts.unshift({ t: Math.min(l.createdAt, first.ts), v: toNum(rq) / toNum(rt) });
    }
    return pts;
  }
  function change24(l) {
    const pts = seriesOf(l);
    if (!pts || !pts.length) return NaN;
    const cut = Date.now() / 1000 - 86400;
    let base = pts[0].v;
    for (const p of pts) { if (p.t <= cut) base = p.v; else break; }
    const now = priceOf(l);
    return base ? ((now - base) / base) * 100 : NaN;
  }

  // ───────────────────────────── network ─────────────────────────────
  function pickDefaultNet() {
    const saved = ls.get("tf-net");
    const deps = window.TF_DEPLOYMENTS || {};
    const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
    const available = CFG.networks.filter((n) => n.demo || deps[String(n.chainId)]);
    const byKey = (k) => CFG.networks.find((n) => n.key === k);
    if (saved && byKey(saved) && (byKey(saved).demo || deps[String(byKey(saved).chainId)] || saved !== "local")) return byKey(saved);
    const live = available.find((n) => !n.demo && (n.key !== "local" || isLocalHost));
    return live || byKey("demo");
  }

  function setNet(net, { silent } = {}) {
    state.net = net;
    state.be = B.make(net);
    state.launches = null; state.launchesErr = null; state.swaps = new Map();
    state.quoteSyms = new Map([[ZERO, "TAO"]]);
    ls.set("tf-net", net.key);
    $$(".net-select").forEach((s) => (s.value = net.key));
    renderBanner();
    updateWallet();
    if (!silent) route();
  }

  function renderBanner() {
    const b = $("#banner");
    if (state.net.demo) {
      b.innerHTML = `<div class="banner"><span>Demo network<span class="banner__long">: every trade is simulated in your browser, no real funds move</span>.</span> <button id="resetDemo">Reset demo</button></div>`;
      $("#resetDemo").onclick = () => { state.be.reset(); toast("ok", "Demo reset", "Fresh markets and a refilled demo wallet."); setNet(state.net); };
    } else if (!state.be.ready) {
      b.innerHTML = `<div class="banner">Tensorforge isn't deployed on ${esc(state.net.name)} yet. <button id="toDemo">Try the demo network</button></div>`;
      $("#toDemo").onclick = () => setNet(CFG.networks.find((n) => n.demo));
    } else b.innerHTML = "";
  }

  async function loadLaunches(force) {
    if (state.launches && !force) return state.launches;
    if (!state.be.ready) { state.launches = []; return state.launches; }
    try {
      const list = await state.be.list();
      await Promise.all([...new Set(list.map((l) => l.quote))].map(async (q) => state.quoteSyms.set(q, await state.be.quoteSymbol(q))));
      if (state.be.demo) await Promise.all(list.map(async (l) => state.swaps.set(l.pool, await state.be.swaps(l))));
      state.launches = list; state.launchesErr = null;
    } catch (e) {
      console.warn(e);
      state.launches = []; state.launchesErr = B.friendlyError(e);
    }
    return state.launches;
  }

  async function loadTaoPrice() {
    try {
      const r = await fetch(CFG.priceFeed, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      state.taoUsd = j.bittensor.usd;
      state.taoChange = j.bittensor.usd_24h_change;
    } catch { state.taoUsd = null; }
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/coins/bittensor/market_chart?vs_currency=usd&days=1");
      if (r.ok) state.taoSeries = (await r.json()).prices.map((p) => p[1]);
    } catch { /* optional */ }
    document.dispatchEvent(new Event("tf:price"));
  }

  // ───────────────────────────── wallet ─────────────────────────────
  async function updateWallet() {
    const label = $("#walletLabel"), dot = $("#walletDot");
    const acct = state.be && state.be.account;
    dot.classList.toggle("is-live", !!acct);
    if (!acct) { label.innerHTML = 'Connect<span class="wallet-label-long"> wallet</span>'; return; }
    let bal = "";
    try { const b = await state.be.nativeBalance(); if (b !== null) bal = ` · ${fmtCompact(toNum(b))} τ`; } catch { /* ignore */ }
    label.textContent = `${state.net.demo ? "Demo " : ""}${short(acct)}${bal}`;
  }
  async function connect() {
    try {
      await state.be.connect();
      toast("ok", "Wallet connected", state.net.demo ? "Demo wallet funded with 250 TAO and 500 wSN10." : short(state.be.account));
      updateWallet();
      document.dispatchEvent(new Event("tf:wallet"));
      return true;
    } catch (e) { toast("err", "Couldn't connect", B.friendlyError(e)); return false; }
  }
  $("#walletBtn").addEventListener("click", async () => {
    if (state.be.account) {
      state.be.disconnect();
      toast("info", "Disconnected", "Your wallet is no longer connected to this site.");
      updateWallet();
      document.dispatchEvent(new Event("tf:wallet"));
    } else connect();
  });
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", () => { if (!state.net.demo && state.be.account) state.be.connect().then(updateWallet).catch(() => { state.be.disconnect(); updateWallet(); }); });
    window.ethereum.on("chainChanged", () => { if (!state.net.demo) { state.be.disconnect(); updateWallet(); } });
  }

  // ───────────────────────────── toasts ─────────────────────────────
  function toast(kind, title, body, ms = 4800) {
    const t = document.createElement("div");
    t.className = `toast toast--${kind}`;
    t.innerHTML = `<span class="toast__dot"></span><div><b>${esc(title)}</b>${body ? `<span class="muted">${esc(body)}</span>` : ""}</div>`;
    $("#toasts").appendChild(t);
    const kill = () => { t.classList.add("is-out"); setTimeout(() => t.remove(), 300); };
    if (ms) setTimeout(kill, ms);
    return { el: t, kill, set(title2, body2, kind2) { if (kind2) t.className = `toast toast--${kind2}`; t.querySelector("b").textContent = title2; const s = t.querySelector("span.muted"); if (s) s.textContent = body2 || ""; else if (body2) t.lastElementChild.insertAdjacentHTML("beforeend", `<span class="muted">${esc(body2)}</span>`); } };
  }

  // ───────────────────────────── components ─────────────────────────────
  function avatar(l, lg, px) {
    const img = safeUrl(l.meta.image);
    const cls = `avatar${lg ? " avatar--lg" : ""}`;
    const size = px ? `width:${px}px;height:${px}px;border-radius:${Math.round(px / 3.4)}px;font-size:${Math.round(px / 2.2)}px;` : "";
    if (img) return `<span class="${cls}" style="${size}${FX.avatarStyle(l.token)}"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
    return `<span class="${cls}" style="${size}${FX.avatarStyle(l.token)}">${esc([...l.symbol][0] || "?")}</span>`;
  }

  function card(l, i = 0) {
    const ch = change24(l);
    const p = priceOf(l);
    const usd = usdOf(l, mcapOf(l));
    return `<a class="mcard reveal" style="--d:${Math.min(i, 8) * 0.05}s" href="#/token/${esc(l.token)}" data-pool="${esc(l.pool)}">
      <div class="mcard__top">${avatar(l)}
        <div style="min-width:0;flex:1"><div class="mcard__name">${esc(l.name)}</div><div class="mcard__sym">$${esc(l.symbol)} / ${esc(qsym(l))}</div></div>
        ${isFinite(ch) ? `<span class="mono ${ch >= 0 ? "up" : "down"}" style="font-size:13px">${pct(ch)}</span>` : ""}
      </div>
      <p class="mcard__desc">${esc(l.meta.description || "No description yet.")}</p>
      <canvas data-spark="${esc(l.pool)}" aria-hidden="true"></canvas>
      <div class="mcard__tags">
        <span class="tag ${kindOf(l) !== "Token" ? "tag--ember" : ""}">${esc(kindOf(l))}${l.meta.netuid ? ` · SN${esc(Number(l.meta.netuid))}` : ""}</span>
        <span class="tag">${esc(sectorLabel(sectorOf(l)))}</span>
        ${Date.now() / 1000 - l.createdAt < 172800 ? '<span class="tag tag--up">New</span>' : ""}
      </div>
      <dl class="mcard__stats">
        <div class="kv"><dt>Price</dt><dd>${fmtPrice(p)} ${esc(qsym(l))}</dd></div>
        <div class="kv"><dt>Mkt cap</dt><dd>${isFinite(usd) ? fmtUsd(usd) : fmtCompact(mcapOf(l)) + " " + esc(qsym(l))}</dd></div>
        <div class="kv"><dt>Liquidity</dt><dd>${fmtCompact(toNum(l.reserveQuote))} ${esc(qsym(l))}</dd></div>
      </dl>
    </a>`;
  }

  function drawSparks(root) {
    $$("canvas[data-spark]", root).forEach((c) => {
      const l = (state.launches || []).find((x) => x.pool === c.dataset.spark);
      if (!l) return;
      const pts = seriesOf(l);
      const vals = pts ? pts.map((p) => p.v) : null;
      const ch = change24(l);
      FX.sparkline(c, vals && vals.length > 1 ? vals : null, { color: !isFinite(ch) || ch >= 0 ? "#5fd49a" : "#ff5d5d" });
    });
  }

  function emptyState(title, body, actions = "") {
    return `<div class="empty reveal"><span class="eyebrow">The next idea starts here</span><h3 class="h3">${title}</h3><p>${body}</p><div class="hero__ctas" style="justify-content:center">${actions}</div></div>`;
  }

  function lookupBlock() {
    return `<div class="lookup reveal">
      <div><span class="eyebrow">Missing a launch?</span><h3 class="h3" style="margin-top:14px">Find it by contract address.</h3>
      <p class="muted" style="margin:10px 0 0;font-size:15px">Already launched through Tensorforge? Paste the token address to open its market instead of deploying again.</p></div>
      <form id="lookupForm" novalidate>
        <input class="input" id="lookupInput" placeholder="0x… token address" autocomplete="off" spellcheck="false" aria-label="Token contract address" />
        <button class="btn btn--ghost" type="submit">Find market <span class="arrow">→</span></button>
      </form></div>`;
  }
  function bindLookup() {
    const f = $("#lookupForm");
    if (!f) return;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = $("#lookupInput").value.trim();
      const input = $("#lookupInput");
      if (!state.net.demo && !ethers.isAddress(v)) { input.classList.add("is-bad"); toast("err", "Invalid address", "Paste a 0x-prefixed 40-character address."); return; }
      input.classList.remove("is-bad");
      try { const l = await state.be.get(v); location.hash = `#/token/${l.token}`; }
      catch (err) { toast("err", "Not found", B.friendlyError(err)); }
    });
  }

  // ───────────────────────────── views ─────────────────────────────
  const views = {};
  // listeners registered by a view are dropped when the route changes
  let viewListeners = [];
  function onView(evt, fn) { document.addEventListener(evt, fn); viewListeners.push([evt, fn]); }
  function clearViewListeners() { viewListeners.forEach(([e, f]) => document.removeEventListener(e, f)); viewListeners = []; }

  views.home = async () => {
    main.innerHTML = `
    <section class="hero">
      <canvas class="hero__canvas" id="heroCanvas" aria-hidden="true"></canvas>
      <div class="wrap hero__content">
        <div class="hero__grid">
          <div class="hero__copy">
            <span class="eyebrow reveal">Token launches on Bittensor</span>
            <h1 class="display" data-split style="margin-top:22px">Strike a token.<br><em>Temper</em> it in TAO.</h1>
            <p class="lead reveal" style="--d:.35s">One transaction mints a fixed-supply token and seeds its own market against native TAO or a supported subnet-alpha receipt. The pool is locked forever — no one, including you, can pull it.</p>
            <div class="hero__ctas reveal" style="--d:.45s">
              <a class="btn btn--ember" href="#/create">Launch a token <span class="arrow">→</span></a>
              <a class="btn btn--ghost" href="#/markets">Explore markets</a>
            </div>
            <div class="chips reveal" style="--d:.55s"><span class="chip"><i></i>Native TAO pairs</span><span class="chip"><i></i>Subnet-alpha pairs</span><span class="chip"><i></i>Locked liquidity</span></div>
          </div>
          <aside class="pricecard reveal" style="--d:.5s" data-tilt>
            <div class="pricecard__row"><span class="eyebrow">TAO / USD</span><span class="tag" id="taoChg">24h —</span></div>
            <div class="pricecard__big" id="taoPx">—</div>
            <div class="muted" style="font-size:13px" id="taoNote">Fetching live price…</div>
            <canvas id="taoSpark" aria-hidden="true"></canvas>
            <dl class="pricecard__foot">
              <div class="kv"><dt>Network</dt><dd>${esc(state.net.name)}</dd></div>
              <div class="kv"><dt>Launches</dt><dd class="mono" id="heroCount">—</dd></div>
            </dl>
          </aside>
        </div>
      </div>
      <svg class="seal" viewBox="0 0 200 200" aria-hidden="true"><defs><path id="sealPath" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs><text><textPath href="#sealPath">LIQUIDITY LOCKED FOREVER · PAIRED WITH TAO · FORGED ON BITTENSOR · </textPath></text><text x="100" y="118" text-anchor="middle" class="seal__tau">τ</text></svg>
      <span class="scroll-cue" aria-hidden="true"></span>
    </section>
    <div class="ticker" id="ticker" aria-label="Recent launches"></div>

    <section class="studio-band" aria-labelledby="studioMark"><div class="wrap studio-band__inner">
      <div class="studio-band__top">
        <div class="studio-band__label reveal"><span class="dotmark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>Single token<br>launch<br>studio</span></div>
        <div class="studio-band__meta reveal" style="--d:.1s"><span>Fixed supply</span><span>Locked pool</span><span>0% to creator</span></div>
      </div>
      <div class="coin-stage reveal" style="--d:.15s" aria-hidden="true">
        <div class="coin"><div class="coin__face coin__face--front"><span>τ</span></div><div class="coin__edge"></div><div class="coin__face coin__face--back"><span>α</span></div></div>
        <div class="coin-shadow"></div>
      </div>
      <div class="studio-band__mark-wrap"><h2 class="studio-band__mark reveal" id="studioMark" style="--d:.2s">tensorforge<sup>τ</sup></h2></div>
      <div class="studio-band__foot reveal" style="--d:.25s">
        <span>Forged on Bittensor EVM · chain 964</span>
        <a class="btn btn--ink" href="#/create">Start your launch <span class="arrow">→</span></a>
      </div>
    </div></section>

    <section class="section--tight"><div class="wrap">
      <div class="stats" id="stats">
        ${["Launches", "Locked liquidity", "Trades indexed", "Execution"].map((k, i) => `<div class="stat reveal" style="--d:${i * 0.08}s"><span class="eyebrow">${k}</span><div class="stat__v" data-stat="${i}">—</div><div class="stat__s" data-stat-s="${i}"></div></div>`).join("")}
      </div>
    </div></section>

    <section class="section" style="padding-bottom:0"><div class="wrap">
      <div class="section__head"><div><span class="eyebrow reveal">How it works</span><h2 class="h2" data-split>Three strikes.<br><em>One transaction.</em></h2></div>
      <p class="lead reveal" style="max-width:40ch">From idea to a live, tradeable market in under a minute — with nothing left to trust.</p></div>
      <div class="steps">
        <article class="step reveal" data-tilt><div class="step__art" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="44" class="ring"/><path d="M40 46h40M60 46v34" class="stroke"/><circle cx="80" cy="78" r="5" class="dot"/></svg></div><span class="step__n">01</span><h3 class="h3">Name it</h3><p>Pick a name, ticker, supply and story. Tag a subnet if it's a subnet coin.</p></article>
        <article class="step reveal" style="--d:.1s" data-tilt><div class="step__art" aria-hidden="true"><svg viewBox="0 0 120 120"><path d="M28 84h64" class="stroke"/><path d="M36 84c6-30 42-30 48 0" class="stroke dash"/><text x="60" y="58" text-anchor="middle" class="glyph">τ</text></svg></div><span class="step__n">02</span><h3 class="h3">Seed it</h3><p>Deposit TAO or subnet alpha. That deposit sets the starting price.</p></article>
        <article class="step reveal" style="--d:.2s" data-tilt><div class="step__art" aria-hidden="true"><svg viewBox="0 0 120 120"><rect x="38" y="54" width="44" height="34" rx="8" class="stroke"/><path d="M46 54v-10a14 14 0 0 1 28 0v10" class="stroke"/><circle cx="60" cy="71" r="4" class="dot"/></svg></div><span class="step__n">03</span><h3 class="h3">Lock it</h3><p>The pool is sealed forever. Trading opens instantly for everyone, creator included.</p></article>
      </div>
    </div></section>

    <section class="section"><div class="wrap pairs">
      <div>
        <span class="eyebrow reveal">Choose your reserve</span>
        <h2 class="h2" data-split>TAO or alpha.<br><em>You pick the floor.</em></h2>
        <p class="lead reveal" style="margin-top:20px">Your token only ever trades against the asset you seed its pool with. Pick native TAO for the deepest audience, or a supported subnet-alpha wrapper to align with a subnet's own economy.</p>
        <div class="hero__ctas reveal" style="margin-top:28px"><a class="btn" href="#/create" id="pairCta">Create your market <span class="arrow">→</span></a><a class="link-arrow" href="#/fund">Need TAO? Fund a wallet →</a></div>
      </div>
      <div class="pair-stack">
        <div class="pair is-on reveal" data-pair="tao" tabindex="0" role="button" aria-pressed="true">
          <span class="pair__glyph">τ</span>
          <div><div class="pair__title">$YOURS / TAO</div><div class="pair__sub">Seed the pool with Bittensor's native currency. Trades and gas in one asset.</div></div>
          <span class="tag tag--ember">Native</span>
        </div>
        <div class="pair reveal" style="--d:.08s" data-pair="alpha" tabindex="0" role="button" aria-pressed="false">
          <span class="pair__glyph">α</span>
          <div><div class="pair__title">$YOURS / subnet alpha</div><div class="pair__sub">Seed with an allow-listed alpha staking receipt. Your market moves with the subnet.</div></div>
          <span class="tag" id="alphaCount">Alpha</span>
        </div>
        <p class="fineprint reveal" style="--d:.16s">Creators provide the initial pool and pay gas in TAO. Alpha pairs need a supported wrapper. Initial liquidity is locked permanently. A pair describes the reserve asset only — it isn't a promise of value or an endorsement by Bittensor or any subnet.</p>
      </div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <div class="section__head"><div><span class="eyebrow reveal">The launch studio</span><h2 class="h2" data-split>Two ways <em>in.</em></h2></div>
      <p class="lead reveal" style="max-width:40ch">Start with a thesis, give it a market, and let the community price it.</p></div>
      <div class="studio">
        <article class="studio-card reveal" data-tilt>
          <div class="studio-card__art" style="background:radial-gradient(circle at 40% 40%, #ff9a4d, #ff6a2b 35%, transparent 70%)"></div>
          <span class="studio-card__num">01 / For an existing subnet</span>
          <h3 class="h2">Back what you believe.</h3>
          <p>Launch an independent community coin around a subnet you follow — its own supply, its own pool, its own crowd.</p>
          <a class="btn" href="#/create?kind=Subnet%20Coin">Launch a subnet coin <span class="arrow">→</span></a>
        </article>
        <article class="studio-card reveal" style="--d:.1s" data-tilt>
          <div class="studio-card__art" style="background:radial-gradient(circle at 40% 40%, #efe8dc, #d9a441 35%, transparent 70%);opacity:.55"></div>
          <span class="studio-card__num">02 / For what comes next</span>
          <h3 class="h2">Pitch the next subnet.</h3>
          <p>Introduce your team and thesis, build in public, and let a market form before you register a netuid.</p>
          <a class="btn btn--ghost" href="#/create?kind=Subnet%20Candidate">Launch a candidate <span class="arrow">→</span></a>
        </article>
      </div>
      <p class="fineprint reveal" style="margin-top:18px">Community tokens are separate from a subnet's alpha and are not issued by subnet owners.</p>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <div class="section__head"><div><span class="eyebrow reveal">Find your next conviction</span><h2 class="h2" data-split>The <em>market</em>, live.</h2></div>
      <a class="link-arrow reveal" href="#/markets">All markets →</a></div>
      <div class="toolbar reveal"><div class="tabs" id="homeTabs" role="tablist">
        <button class="is-on" data-tab="all" role="tab">All</button><button data-tab="coins" role="tab">Subnet coins</button><button data-tab="new" role="tab">New</button><button data-tab="candidates" role="tab">Candidates</button>
      </div><span class="faint mono" style="font-size:12px" id="srcNote"></span></div>
      <div class="grid-cards" id="homeGrid">${'<div class="skeleton"></div>'.repeat(3)}</div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <div class="section__head"><div><span class="eyebrow reveal">Sectors</span><h2 class="h2" data-split>Big ideas start<br><em>before</em> a subnet.</h2></div>
      <a class="link-arrow reveal" href="#/subnets">Browse subnets →</a></div>
      <div class="sectors" id="sectors">${CFG.sectors.map((s, i) => `<a class="sector reveal" style="--d:${(i % 4) * 0.06}s" href="#/markets?sector=${s.key}"><span class="sector__n">${String(i + 1).padStart(2, "0")}</span><span class="sector__c" data-sector="${s.key}"></span><div><div class="sector__t">${s.label}</div><div class="sector__b">${s.blurb}</div></div></a>`).join("")}</div>
    </div></section>

    <section class="section--tight" style="padding-top:0"><div class="wrap">${lookupBlock()}</div></section>

    <section class="section--tight"><div class="wrap">
      <div class="cta reveal">
        <svg class="cta__rings" viewBox="0 0 200 200" aria-hidden="true">${[20, 40, 60, 80, 98].map((r) => `<circle cx="100" cy="100" r="${r}"/>`).join("")}</svg>
        <h2 class="display" data-split>Your<br><em>move.</em></h2>
        <p>An open market of ideas, priced by the people who care about them.</p>
        <a class="btn" href="#/create">Get started <span class="arrow">→</span></a>
      </div>
    </div></section>`;

    FX.heroLattice($("#heroCanvas"));
    FX.fitText($("#studioMark"));
    FX.reveals(main);
    bindLookup();

    $$("[data-pair]").forEach((p) => {
      const pick = () => {
        $$("[data-pair]").forEach((x) => { x.classList.toggle("is-on", x === p); x.setAttribute("aria-pressed", x === p); });
        $("#pairCta").href = `#/create?pair=${p.dataset.pair}`;
      };
      p.addEventListener("click", pick);
      p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });

    const renderPrice = () => {
      if (!$("#taoPx")) return;
      if (state.taoUsd) {
        $("#taoPx").textContent = "$" + state.taoUsd.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
        $("#taoNote").textContent = "Live market price · CoinGecko";
        const c = state.taoChange;
        $("#taoChg").textContent = `24h ${pct(c)}`;
        $("#taoChg").className = `tag ${c >= 0 ? "tag--up" : ""}`;
        if (c < 0) $("#taoChg").style.color = "var(--down)";
      } else { $("#taoPx").textContent = "—"; $("#taoNote").textContent = "Price feed unavailable right now."; }
      FX.sparkline($("#taoSpark"), state.taoSeries, { color: (state.taoChange ?? 0) >= 0 ? "#5fd49a" : "#ff5d5d" });
      const s3 = $('[data-stat="3"]');
      if (s3) { s3.textContent = state.net.demo ? "Demo" : `Chain ${state.net.chainId}`; $('[data-stat-s="3"]').textContent = state.net.name; }
    };
    renderPrice();
    onView("tf:price", renderPrice);

    const list = await loadLaunches();
    if (!$("#homeGrid")) return; // navigated away
    // stats
    $("#heroCount").textContent = list.length;
    const lockedTao = list.filter(isNative).reduce((a, l) => a + toNum(l.reserveQuote), 0);
    const trades = [...state.swaps.values()].reduce((a, s) => a + s.length, 0);
    FX.countUp($('[data-stat="0"]'), list.length, (v) => Math.round(v).toString());
    $('[data-stat-s="0"]').textContent = state.launchesErr ? state.launchesErr : `on ${state.net.name}`;
    FX.countUp($('[data-stat="1"]'), lockedTao, (v) => fmtCompact(v) + " τ");
    $('[data-stat-s="1"]').textContent = state.taoUsd ? `≈ ${fmtUsd(lockedTao * state.taoUsd)} in TAO pools` : "in TAO pools";
    if (state.be.demo) { FX.countUp($('[data-stat="2"]'), trades, (v) => Math.round(v).toString()); $('[data-stat-s="2"]').textContent = "across all pools"; }
    else { $('[data-stat="2"]').textContent = "On-chain"; $('[data-stat-s="2"]').textContent = "Swap events per market"; }
    renderPrice();
    const alphaPairs = new Set(list.filter((l) => !isNative(l)).map((l) => l.quote)).size;
    try { const qa = await state.be.quoteAssets(); $("#alphaCount") && ($("#alphaCount").textContent = `${qa.length - 1} alpha asset${qa.length - 1 === 1 ? "" : "s"}`); } catch { $("#alphaCount") && ($("#alphaCount").textContent = `${alphaPairs} live`); }
    CFG.sectors.forEach((s) => { const el = $(`[data-sector="${s.key}"]`); if (el) el.textContent = list.filter((l) => sectorOf(l) === s.key).length || ""; });
    $("#srcNote").textContent = state.net.demo ? "Source · demo network" : `Source · ${state.net.name} factory ${short(state.be.factory || "")}`;

    // ticker
    if (list.length) {
      const items = list.slice(0, 12).map((l) => { const c = change24(l); return `<a class="ticker__item" href="#/token/${esc(l.token)}">${avatar(l, false, 24)}<b>$${esc(l.symbol)}</b><span class="mono muted">${fmtPrice(priceOf(l))} ${esc(qsym(l))}</span>${isFinite(c) ? `<span class="mono ${c >= 0 ? "up" : "down"}">${pct(c)}</span>` : ""}</a>`; }).join("");
      $("#ticker").innerHTML = `<div class="ticker__track">${items}${items}</div>`;
      $$(".ticker__track > a:nth-child(n+" + (Math.min(list.length, 12) + 1) + ")").forEach((a) => a.setAttribute("aria-hidden", "true"));
    } else $("#ticker").remove();

    const renderGrid = (tab) => {
      const filtered = filterLaunches(list, { tab }).slice(0, 6);
      $("#homeGrid").innerHTML = filtered.length ? filtered.map(card).join("") :
        emptyState("Your launch belongs here.", state.launchesErr ? esc(state.launchesErr) : "Nothing in this view yet. Explore Bittensor or forge a market of your own.", `<a class="btn btn--ember" href="#/create">Create a market</a><a class="btn btn--ghost" href="#/subnets">Explore subnets</a>`);
      FX.reveals($("#homeGrid")); drawSparks($("#homeGrid"));
    };
    renderGrid("all");
    $$("#homeTabs button").forEach((b) => b.addEventListener("click", () => {
      $$("#homeTabs button").forEach((x) => x.classList.toggle("is-on", x === b));
      renderGrid(b.dataset.tab);
    }));
  };

  function filterLaunches(list, { tab = "all", sector = "", q = "", sort = "new" }) {
    let out = list.slice();
    if (tab === "coins") out = out.filter((l) => kindOf(l) === "Subnet Coin");
    if (tab === "candidates") out = out.filter((l) => kindOf(l) === "Subnet Candidate");
    if (tab === "new") out = out.filter((l) => Date.now() / 1000 - l.createdAt < 172800);
    if (sector) out = out.filter((l) => sectorOf(l) === sector);
    if (q) {
      const s = q.toLowerCase();
      out = out.filter((l) => l.name.toLowerCase().includes(s) || l.symbol.toLowerCase().includes(s) || l.token.toLowerCase() === s);
    }
    const tv = (l) => (isNative(l) ? 1 : 0.5); // rough cross-asset weighting for sorting only
    if (sort === "mcap") out.sort((a, b) => mcapOf(b) * tv(b) - mcapOf(a) * tv(a));
    if (sort === "liq") out.sort((a, b) => toNum(b.reserveQuote) * tv(b) - toNum(a.reserveQuote) * tv(a));
    if (sort === "gainers") out.sort((a, b) => (change24(b) || -1e9) - (change24(a) || -1e9));
    if (sort === "new") out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  views.markets = async (params) => {
    const st = { tab: params.get("tab") || "all", sector: params.get("sector") || "", q: params.get("q") || "", sort: params.get("sort") || "new" };
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="page__head"><span class="eyebrow reveal">Discover</span><h1 class="display" data-split style="margin-top:18px">Every market,<br><em>one place.</em></h1></div>
      <div class="toolbar reveal">
        <div class="tabs" id="mTabs" role="tablist">${[["all", "All markets"], ["coins", "Subnet coins"], ["new", "New launches"], ["candidates", "Candidates"]].map(([k, v]) => `<button data-tab="${k}" class="${st.tab === k ? "is-on" : ""}" role="tab">${v}</button>`).join("")}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1;justify-content:flex-end">
          <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="mSearch" placeholder="Search name, ticker or address" value="${esc(st.q)}" aria-label="Search markets"></label>
          <select class="select" id="mSort" aria-label="Sort">${[["new", "Newest"], ["mcap", "Market cap"], ["liq", "Liquidity"], ["gainers", "24h change"]].map(([k, v]) => `<option value="${k}" ${st.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          <button class="btn btn--ghost btn--sm" id="mRefresh" style="height:42px">Refresh</button>
        </div>
      </div>
      <div class="chips reveal" id="mSectors" style="margin:0 0 28px"><button class="chip chip--btn ${!st.sector ? "is-on" : ""}" data-sector="">All sectors</button>${CFG.sectors.map((s) => `<button class="chip chip--btn ${st.sector === s.key ? "is-on" : ""}" data-sector="${s.key}">${s.label}</button>`).join("")}</div>
      <div class="grid-cards" id="mGrid">${'<div class="skeleton"></div>'.repeat(6)}</div>
      <p class="faint mono" style="font-size:12px;margin-top:20px" id="mNote"></p>
      <div style="margin-top:64px">${lookupBlock()}</div>
    </div></section>`;
    FX.reveals(main); bindLookup();

    const sync = () => {
      const p = new URLSearchParams();
      if (st.tab !== "all") p.set("tab", st.tab);
      if (st.sector) p.set("sector", st.sector);
      if (st.q) p.set("q", st.q);
      if (st.sort !== "new") p.set("sort", st.sort);
      const h = `#/markets${p.toString() ? "?" + p : ""}`;
      if (location.hash !== h) history.replaceState(null, "", h);
    };
    const render = () => {
      const list = state.launches || [];
      const out = filterLaunches(list, st);
      $("#mGrid").innerHTML = out.length ? out.map(card).join("") :
        emptyState(list.length ? "Nothing matches that." : "Your launch belongs here.", state.launchesErr ? esc(state.launchesErr) : list.length ? "Try another filter or clear your search." : `No launches on ${esc(state.net.name)} yet. Be the first.`, `<a class="btn btn--ember" href="#/create">Create a market</a>`);
      $("#mNote").textContent = `${out.length} of ${list.length} markets · ${state.net.name}`;
      FX.reveals($("#mGrid")); drawSparks($("#mGrid")); sync();
    };
    $$("#mTabs button").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; $$("#mTabs button").forEach((x) => x.classList.toggle("is-on", x === b)); render(); }));
    $$("#mSectors button").forEach((b) => b.addEventListener("click", () => { st.sector = b.dataset.sector; $$("#mSectors button").forEach((x) => x.classList.toggle("is-on", x === b)); render(); }));
    let deb;
    $("#mSearch").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value.trim(); render(); }, 120); });
    $("#mSort").addEventListener("change", (e) => { st.sort = e.target.value; render(); });
    $("#mRefresh").addEventListener("click", async () => { $("#mGrid").innerHTML = '<div class="skeleton"></div>'.repeat(3); await loadLaunches(true); render(); });
    await loadLaunches();
    if ($("#mGrid")) render();
  };

  views.subnets = async () => {
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="page__head"><span class="eyebrow reveal">Bittensor subnets</span><h1 class="display" data-split style="margin-top:18px">Intelligence,<br><em>in the open.</em></h1>
      <p class="lead reveal" style="margin-top:22px">A hand-picked directory of subnets to get you oriented. Names and owners change — each entry links to the live explorer, which is the source of truth.</p></div>
      <div class="grid-cards" id="snGrid"></div>
      <p class="fineprint reveal" style="margin-top:24px">Community coins launched here are independent of subnet teams and are not subnet alpha.</p>
    </div></section>`;
    await loadLaunches();
    const list = state.launches || [];
    $("#snGrid").innerHTML = CFG.subnets.map((s, i) => {
      const coins = list.filter((l) => Number(l.meta.netuid) === s.netuid).length;
      return `<article class="mcard reveal" style="--d:${(i % 6) * 0.04}s">
        <div class="mcard__top"><span class="avatar" style="${FX.avatarStyle("sn" + s.netuid)}">${s.netuid}</span>
        <div style="flex:1;min-width:0"><div class="mcard__name">${esc(s.name)}</div><div class="mcard__sym">SN${s.netuid} · ${esc(sectorLabel(s.sector))}</div></div>
        ${coins ? `<span class="tag tag--ember">${coins} coin${coins > 1 ? "s" : ""}</span>` : ""}</div>
        <p class="mcard__desc">${esc(s.note)}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn--sm" href="#/create?kind=Subnet%20Coin&netuid=${s.netuid}&sector=${s.sector}">Launch a coin</a>
          ${coins ? `<a class="btn btn--sm btn--ghost" href="#/markets?q=&tab=coins&sector=${s.sector}">View coins</a>` : ""}
          <a class="btn btn--sm btn--ghost" href="${esc(CFG.subnetExplorer(s.netuid))}" target="_blank" rel="noopener">Explorer ↗</a>
        </div></article>`;
    }).join("");
    FX.reveals(main);
  };

  views.create = async (params) => {
    const kind0 = ["Token", "Subnet Coin", "Subnet Candidate"].includes(params.get("kind")) ? params.get("kind") : "Token";
    const f = { kind: kind0, name: "", symbol: "", supply: "1000000000", description: "", image: "", website: "", x: "", sector: params.get("sector") || "agents", netuid: params.get("netuid") || "", quote: ZERO, liq: "1", ack: false };
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="page__head"><span class="eyebrow reveal">Create</span><h1 class="display" data-split style="margin-top:18px">Forge a <em>market.</em></h1>
      <p class="lead reveal" style="margin-top:22px">Fill in the basics, choose a reserve asset and seed the pool. Everything deploys in a single transaction.</p></div>
      <div class="create">
        <form id="cForm" class="panel reveal" novalidate>
          <div class="field"><span class="label">What are you launching?</span>
            <div class="segmented" id="cKind">${["Token", "Subnet Coin", "Subnet Candidate"].map((k) => `<button type="button" data-k="${k}" class="${k === f.kind ? "is-on" : ""}">${k}</button>`).join("")}</div>
            <small id="cKindHelp"></small></div>
          <div class="row2">
            <div class="field"><label for="cName">Name</label><input class="input" id="cName" maxlength="48" placeholder="e.g. Lattice Agents" autocomplete="off"></div>
            <div class="field"><label for="cSym">Ticker</label><input class="input mono" id="cSym" maxlength="12" placeholder="LATT" autocomplete="off" style="text-transform:uppercase"></div>
          </div>
          <div class="field"><label for="cDesc">Description</label><textarea class="textarea" id="cDesc" maxlength="600" placeholder="What's the thesis? Why should anyone care?"></textarea><small><span id="cDescN">0</span>/600</small></div>
          <div class="row2">
            <div class="field"><label for="cSector">Sector</label><select id="cSector">${CFG.sectors.map((s) => `<option value="${s.key}" ${s.key === f.sector ? "selected" : ""}>${s.label}</option>`).join("")}</select></div>
            <div class="field" id="cNetuidWrap"><label for="cNetuid">Subnet (netuid)</label><input class="input mono" id="cNetuid" inputmode="numeric" placeholder="e.g. 64" value="${esc(f.netuid)}"></div>
          </div>
          <div class="field"><label for="cImg">Image URL <span class="faint">(optional)</span></label><input class="input" id="cImg" placeholder="https://…/logo.png" autocomplete="off"></div>
          <div class="row2">
            <div class="field"><label for="cWeb">Website <span class="faint">(optional)</span></label><input class="input" id="cWeb" placeholder="https://" autocomplete="off"></div>
            <div class="field"><label for="cX">X handle <span class="faint">(optional)</span></label><input class="input" id="cX" placeholder="@handle" autocomplete="off"></div>
          </div>
          <div class="field"><label for="cSupply">Total supply</label><input class="input mono" id="cSupply" inputmode="numeric" value="${f.supply}"><small>Minted once, entirely into the pool. Nobody — including you — starts with a balance.</small></div>
          <div class="field"><span class="label">Reserve asset</span><div class="segmented" id="cQuote"><button type="button" class="is-on">τ TAO</button></div><small id="cQuoteHelp"></small></div>
          <div class="field"><label for="cLiq">Initial liquidity</label>
            <div class="amount"><div class="amount__top"><span>You deposit</span><span id="cBal"></span></div>
            <div style="display:flex;align-items:center;gap:10px"><input id="cLiq" inputmode="decimal" value="${f.liq}" aria-label="Initial liquidity amount"><span class="amount__asset" id="cLiqSym">TAO</span></div>
            <div class="amount__bot"><span id="cLiqMin"></span><span></span></div></div>
            <small>Sets the starting price. This deposit is locked in the pool permanently and cannot be withdrawn.</small></div>
          <label class="check"><input type="checkbox" id="cAck"> <span>I understand the pool is locked forever, my token has no guaranteed value, and I've read the <a href="#/risk" class="link-arrow" style="padding:0;border:0;color:var(--ember-2)">risk disclosure</a>.</span></label>
          <button class="btn btn--ember btn--block" id="cSubmit" type="submit" style="height:56px">Launch market <span class="arrow">→</span></button>
        </form>
        <aside class="reveal" style="--d:.1s">
          <div class="panel"><span class="eyebrow">Preview</span><div id="cPreview" style="margin-top:18px"></div></div>
          <div class="panel"><span class="eyebrow">Summary</span><dl class="summary" id="cSummary" style="margin-top:18px"></dl></div>
        </aside>
      </div>
    </div></section>`;
    FX.reveals(main);
    // never let the browser do a native form submit, even before the async setup below finishes
    let formReady = false;
    $("#cForm").addEventListener("submit", (e) => { e.preventDefault(); if (!formReady) toast("info", "One moment", "Loading network settings…", 2000); });
    $("#cSubmit").disabled = true;

    let assets = [{ asset: ZERO, label: "TAO", symbol: "TAO", min: ethers.parseEther("0.1") }];
    let fee = 0n;
    const wantAlpha = params.get("pair") === "alpha";
    try {
      if (state.be.ready) {
        assets = await state.be.quoteAssets();
        if (!state.be.demo) fee = await (new ethers.Contract(state.be.factory, window.TF_ABI.factory, new ethers.JsonRpcProvider(state.net.rpc, state.net.chainId, { staticNetwork: true }))).launchFee();
      }
    } catch (e) { console.warn(e); }
    if (!$("#cForm")) return;
    if (wantAlpha && assets[1]) f.quote = assets[1].asset;
    $("#cQuote").innerHTML = assets.map((a) => `<button type="button" data-q="${esc(a.asset)}" class="${a.asset === f.quote ? "is-on" : ""}">${a.asset === ZERO ? "τ TAO" : "α " + esc(a.label)}</button>`).join("");
    $("#cQuoteHelp").textContent = assets.length > 1 ? "Alpha pairs use an allow-listed staking-receipt wrapper." : "Alpha reserves appear here once a wrapper is allow-listed on this network.";

    const el = (id) => $("#" + id);
    const asset = () => assets.find((a) => a.asset === f.quote) || assets[0];
    const kindHelp = { Token: "A standalone community token in any sector.", "Subnet Coin": "An independent community coin around an existing subnet. Not the subnet's alpha.", "Subnet Candidate": "A market for a subnet that doesn't exist yet. Share your thesis and build in public." };

    async function refreshBal() {
      try {
        const b = await state.be.assetBalance(f.quote);
        el("cBal").innerHTML = b === null ? '<button type="button" class="amount__max" id="cConn">Connect wallet</button>' : `Balance ${fmtCompact(toNum(b))} <button type="button" class="amount__max" id="cMax">MAX</button>`;
        if (el("cConn")) el("cConn").onclick = connect;
        if (el("cMax")) el("cMax").onclick = () => {
          // leave a little native TAO for gas
          let v = b; if (f.quote === ZERO && !state.be.demo) v = b > ethers.parseEther("0.02") ? b - ethers.parseEther("0.02") - fee : 0n;
          el("cLiq").value = trimNum(v > 0n ? v : 0n); f.liq = el("cLiq").value; update();
        };
      } catch { el("cBal").textContent = ""; }
    }

    function validate() {
      const errs = {};
      const enc = (s) => new TextEncoder().encode(s).length;
      if (!f.name.trim() || enc(f.name.trim()) > 48) errs.cName = "Name is required (max 48 bytes)";
      if (!/^[A-Z0-9$._-]{1,12}$/.test(f.symbol)) errs.cSym = "1–12 characters: A–Z, 0–9, $ . _ -";
      const sup = /^\d+$/.test(f.supply) ? BigInt(f.supply) : 0n;
      if (sup < 1n || sup > 10n ** 15n) errs.cSupply = "Between 1 and 1,000,000,000,000,000";
      const liq = parseAmount(f.liq);
      if (liq === null || liq === 0n) errs.cLiq = "Enter an amount";
      else if (liq < asset().min) errs.cLiq = `Minimum ${trimNum(asset().min)} ${asset().symbol}`;
      if (f.kind === "Subnet Coin" && !/^\d{1,5}$/.test(f.netuid)) errs.cNetuid = "Enter the subnet's netuid";
      if (f.image && !safeUrl(f.image)) errs.cImg = "Must be an http(s) URL";
      if (f.website && !safeUrl(f.website)) errs.cWeb = "Must be an http(s) URL";
      if (f.x && !/^@?[A-Za-z0-9_]{1,15}$/.test(f.x)) errs.cX = "Letters, numbers and _ (max 15)";
      if (enc(metadata()) > 2048) errs.cDesc = "Too long once encoded";
      return errs;
    }
    function metadata() {
      const m = { description: f.description.trim(), sector: f.sector, kind: f.kind };
      if (f.kind !== "Token" && /^\d+$/.test(f.netuid)) m.netuid = Number(f.netuid);
      if (safeUrl(f.image)) m.image = safeUrl(f.image);
      if (safeUrl(f.website)) m.website = safeUrl(f.website);
      if (f.x) m.x = f.x.replace(/^@/, "");
      return JSON.stringify(m);
    }
    function update(showErrors) {
      el("cKindHelp").textContent = kindHelp[f.kind];
      el("cNetuidWrap").style.display = f.kind === "Token" ? "none" : "";
      el("cNetuid").previousElementSibling.textContent = f.kind === "Subnet Candidate" ? "Target netuid (optional)" : "Subnet (netuid)";
      el("cLiqSym").textContent = asset().symbol;
      el("cLiqMin").textContent = `Minimum ${trimNum(asset().min)} ${asset().symbol}`;
      el("cDescN").textContent = f.description.length;
      const errs = validate();
      ["cName", "cSym", "cSupply", "cLiq", "cNetuid", "cImg", "cWeb", "cX", "cDesc"].forEach((k) => el(k).classList.toggle("is-bad", !!(showErrors && errs[k]) || (!!errs[k] && el(k).dataset.touched)));
      const liq = parseAmount(f.liq) || 0n;
      const sup = /^\d+$/.test(f.supply) ? Number(f.supply) : 0;
      const price = sup ? toNum(liq) / sup : 0;
      const pseudo = { token: "preview" + f.symbol, symbol: f.symbol || "?", meta: { image: f.image } };
      const usd = f.quote === ZERO && state.taoUsd ? price * sup * state.taoUsd : NaN;
      el("cPreview").innerHTML = `<div class="mcard" style="pointer-events:none"><div class="mcard__top">${avatar(pseudo)}<div style="min-width:0;flex:1"><div class="mcard__name">${esc(f.name || "Your token")}</div><div class="mcard__sym">$${esc(f.symbol || "TICKER")} / ${esc(asset().symbol)}</div></div></div>
        <p class="mcard__desc">${esc(f.description || "Your thesis goes here.")}</p>
        <div class="mcard__tags"><span class="tag tag--ember">${esc(f.kind)}${f.kind !== "Token" && f.netuid ? " · SN" + esc(f.netuid) : ""}</span><span class="tag">${esc(sectorLabel(f.sector))}</span></div>
        <dl class="mcard__stats"><div class="kv"><dt>Start price</dt><dd>${fmtPrice(price)}</dd></div><div class="kv"><dt>Start mcap</dt><dd>${isFinite(usd) ? fmtUsd(usd) : fmtCompact(price * sup)}</dd></div><div class="kv"><dt>Locked</dt><dd>${fmtCompact(toNum(liq))}</dd></div></dl></div>`;
      el("cSummary").innerHTML = [
        ["Network", esc(state.net.name)],
        ["Supply to pool", `${fmtCompact(sup)} (100%)`],
        ["Locked liquidity", `${fmtCompact(toNum(liq))} ${esc(asset().symbol)}`],
        ["Launch fee", `${trimNum(fee)} TAO`],
        ["Trading fee", "1% (0.5% protocol · 0.5% stays in pool)"],
        ["Creator allocation", "None"],
        ["Contract upgrades", "None — immutable"],
      ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
      el("cSubmit").disabled = !f.ack || !state.be.ready;
      el("cSubmit").innerHTML = !state.be.ready ? `Not available on ${esc(state.net.name)}` : !state.be.account ? 'Connect wallet &amp; launch <span class="arrow">→</span>' : 'Launch market <span class="arrow">→</span>';
      return errs;
    }

    const bind = (id, key, tf = (v) => v) => el(id).addEventListener("input", (e) => { const v = tf(e.target.value); if (v !== e.target.value) e.target.value = v; f[key] = v; update(); });
    const blur = (id) => el(id).addEventListener("blur", () => { el(id).dataset.touched = 1; update(); });
    bind("cName", "name"); bind("cSym", "symbol", (v) => v.toUpperCase().replace(/\s/g, "")); bind("cDesc", "description");
    bind("cSupply", "supply", (v) => v.replace(/[^\d]/g, "")); bind("cLiq", "liq", (v) => v.replace(/[^\d.]/g, "")); bind("cNetuid", "netuid", (v) => v.replace(/[^\d]/g, ""));
    bind("cImg", "image"); bind("cWeb", "website"); bind("cX", "x");
    ["cName", "cSym", "cSupply", "cLiq", "cNetuid", "cImg", "cWeb", "cX"].forEach(blur);
    el("cSector").addEventListener("change", (e) => { f.sector = e.target.value; update(); });
    el("cAck").addEventListener("change", (e) => { f.ack = e.target.checked; update(); });
    $$("#cKind button").forEach((b) => b.addEventListener("click", () => { f.kind = b.dataset.k; $$("#cKind button").forEach((x) => x.classList.toggle("is-on", x === b)); update(); }));
    $$("#cQuote button").forEach((b) => b.addEventListener("click", () => { f.quote = b.dataset.q; $$("#cQuote button").forEach((x) => x.classList.toggle("is-on", x === b)); update(); refreshBal(); }));
    const onWallet = () => { if (el("cForm")) { refreshBal(); update(); } };
    onView("tf:wallet", onWallet);

    el("cForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!formReady) return;
      const errs = update(true);
      const first = Object.keys(errs)[0];
      if (first) { el(first).focus(); toast("err", "Check the form", errs[first]); return; }
      if (!state.be.account && !(await connect())) return;
      const btn = el("cSubmit");
      btn.disabled = true;
      const t = toast("wait", "Launching…", "Preparing transaction", 0);
      try {
        const token = await state.be.create({
          name: f.name.trim(), symbol: f.symbol, supply: BigInt(f.supply) * 10n ** 18n,
          metadata: metadata(), quote: f.quote, quoteAmount: parseAmount(f.liq),
        }, (msg) => t.set("Launching…", msg));
        t.set("Market is live", `$${f.symbol} is trading.`, "ok"); setTimeout(t.kill, 4000);
        state.launches = null;
        location.hash = `#/token/${token}`;
      } catch (err) {
        console.warn(err);
        t.set("Launch failed", B.friendlyError(err), "err"); setTimeout(t.kill, 7000);
        btn.disabled = false; update();
      }
    });
    // pick up anything typed while network settings were loading
    const pull = { cName: "name", cSym: "symbol", cDesc: "description", cSupply: "supply", cLiq: "liq", cNetuid: "netuid", cImg: "image", cWeb: "website", cX: "x" };
    Object.entries(pull).forEach(([id, key]) => { if (el(id)) el(id).dispatchEvent(new Event("input")); });
    f.sector = el("cSector").value; f.ack = el("cAck").checked;
    formReady = true;
    update(); refreshBal();
  };

  views.token = async (params, addr) => {
    main.innerHTML = `<section class="page"><div class="wrap"><div class="skeleton" style="height:80px;margin-bottom:24px"></div><div class="tgrid"><div class="skeleton" style="height:420px"></div><div class="skeleton" style="height:420px"></div></div></div></section>`;
    let l;
    try { l = await state.be.get(addr); } catch (e) {
      main.innerHTML = `<section class="page"><div class="wrap">${emptyState("Market not found", esc(B.friendlyError(e)), '<a class="btn" href="#/markets">Back to markets</a>')}</div></section>`;
      FX.reveals(main); return;
    }
    state.quoteSyms.set(l.quote, await state.be.quoteSymbol(l.quote));
    const Q = qsym(l);
    let mode = "buy", slip = Number(ls.get("tf-slip")) || 1, swaps = [];

    const x = l.meta.x && /^[A-Za-z0-9_]{1,15}$/.test(l.meta.x) ? l.meta.x : "";
    const web = safeUrl(l.meta.website);
    const exAddr = (a) => state.be.explorerAddr(a);
    const addrRow = (label, a) => `<div><dt>${label}</dt><dd><span class="addr">${exAddr(a) ? `<a href="${esc(exAddr(a))}" target="_blank" rel="noopener">${short(a)}</a>` : short(a)}<button class="copy" data-copy="${esc(a)}" aria-label="Copy ${label} address"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></span></dd></div>`;

    main.innerHTML = `<section class="page"><div class="wrap">
      <a href="#/markets" class="faint" style="font-size:14px">← All markets</a>
      <div class="tokenhead reveal" style="margin-top:18px">${avatar(l, true)}
        <div><h1>${esc(l.name)}</h1><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <span class="tag">$${esc(l.symbol)} / ${esc(Q)}</span><span class="tag tag--ember">${esc(kindOf(l))}${l.meta.netuid ? ` · SN${esc(Number(l.meta.netuid))}` : ""}</span><span class="tag">${esc(sectorLabel(sectorOf(l)))}</span><span class="tag tag--up">🔒 Liquidity locked</span>
        </div></div>
        <div class="tokenhead__price"><div class="big" id="tPrice"></div><div class="mono" id="tChg" style="font-size:14px;margin-top:6px"></div></div>
      </div>
      <div class="tgrid">
        <div>
          <div class="panel reveal"><div class="statgrid" id="tStats"></div></div>
          <div class="panel reveal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span class="eyebrow">Price · ${esc(Q)}</span><span class="faint mono" style="font-size:12px" id="tChartNote"></span></div><div class="chart" id="tChart"></div></div>
          <div class="panel reveal"><span class="eyebrow">Recent trades</span><div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Type</th><th>${esc(Q)}</th><th>${esc(l.symbol)}</th><th>Trader</th><th>Time</th></tr></thead><tbody id="tTrades"><tr><td colspan="5" class="faint">Loading…</td></tr></tbody></table></div></div>
        </div>
        <div>
          <div class="panel trade reveal" id="tTrade">
            <div class="segmented" id="tMode"><button type="button" data-m="buy" class="is-on">Buy</button><button type="button" data-m="sell">Sell</button></div>
            <div class="amount"><div class="amount__top"><span>You pay</span><span id="tBalIn"></span></div>
              <div style="display:flex;align-items:center;gap:10px"><input id="tIn" inputmode="decimal" placeholder="0.0" autocomplete="off" aria-label="Amount in"><span class="amount__asset" id="tInSym"></span></div></div>
            <div class="swap-arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
            <div class="amount"><div class="amount__top"><span>You receive (est.)</span><span id="tBalOut"></span></div>
              <div style="display:flex;align-items:center;gap:10px"><input id="tOut" readonly placeholder="0.0" tabindex="-1" aria-label="Estimated amount out"><span class="amount__asset" id="tOutSym"></span></div></div>
            <div class="slip"><span>Slippage</span>${[0.5, 1, 3, 5].map((s) => `<button type="button" data-s="${s}" class="${s === slip ? "is-on" : ""}">${s}%</button>`).join("")}</div>
            <dl class="summary" id="tInfo" style="margin-bottom:18px"></dl>
            <button class="btn btn--ember btn--block" id="tGo" style="height:54px"></button>
            <p class="fineprint" style="margin-top:14px">1% fee per trade: 0.5% to the protocol, 0.5% stays in the locked pool.</p>
          </div>
          <div class="panel reveal"><span class="eyebrow">About</span>
            <p class="muted" style="margin:14px 0 18px;white-space:pre-wrap;overflow-wrap:anywhere">${esc(l.meta.description || "The creator hasn't added a description.")}</p>
            ${web || x ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">${web ? `<a class="btn btn--sm btn--ghost" href="${esc(web)}" target="_blank" rel="noopener nofollow ugc">Website ↗</a>` : ""}${x ? `<a class="btn btn--sm btn--ghost" href="https://x.com/${esc(x)}" target="_blank" rel="noopener nofollow ugc">@${esc(x)} ↗</a>` : ""}</div>` : ""}
            <dl class="infolist">${addrRow("Token", l.token)}${addrRow("Pool", l.pool)}${addrRow("Creator", l.creator)}${!isNative(l) ? addrRow("Reserve", l.quote) : ""}<div><dt>Launched</dt><dd>${new Date(l.createdAt * 1000).toLocaleString()}</dd></div></dl>
          </div>
        </div>
      </div>
    </div></section>`;
    FX.reveals(main);
    $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast("ok", "Copied", short(b.dataset.copy), 2000); } catch { toast("err", "Copy failed", b.dataset.copy); }
    }));

    function renderHead() {
      const p = priceOf(l), ch = change24(l);
      const usd = usdOf(l, p);
      $("#tPrice").innerHTML = `${fmtPrice(p)} <span class="faint" style="font-size:.5em">${esc(Q)}</span>`;
      $("#tChg").innerHTML = `${isFinite(usd) ? `<span class="muted">${fmtUsd(usd)}</span> · ` : ""}${isFinite(ch) ? `<span class="${ch >= 0 ? "up" : "down"}">${pct(ch)} 24h</span>` : ""}`;
      const mc = mcapOf(l), mcu = usdOf(l, mc);
      const circ = toNum(l.totalSupply - l.reserveToken);
      const vol24 = swaps.filter((s) => s.ts > Date.now() / 1000 - 86400).reduce((a, s) => a + toNum(s.quoteAmount), 0);
      $("#tStats").innerHTML = [
        ["Market cap", isFinite(mcu) ? fmtUsd(mcu) : `${fmtCompact(mc)} ${esc(Q)}`],
        ["Liquidity", `${fmtCompact(toNum(l.reserveQuote))} ${esc(Q)}`],
        ["24h volume", `${fmtCompact(vol24)} ${esc(Q)}`],
        ["Circulating", `${fmtCompact(circ)} <span class="faint">/ ${fmtCompact(toNum(l.totalSupply))}</span>`],
      ].map(([k, v]) => `<div class="kv"><dt>${k}</dt><dd class="mono" style="font-size:18px">${v}</dd></div>`).join("");
    }

    async function loadSwaps() {
      try {
        swaps = await state.be.swaps(l);
        state.swaps.set(l.pool, swaps);
        if (!$("#tChartNote")) return;
        $("#tChartNote").textContent = state.be.demo ? `${swaps.length} trades` : `${swaps.length} trades · recent on-chain window`;
      } catch (e) { console.warn(e); if ($("#tChartNote")) $("#tChartNote").textContent = "Trade history unavailable"; swaps = []; }
      if (!$("#tChart") || !$("#tTrades")) return;
      const pts = seriesOf(l) || [];
      FX.priceChart($("#tChart"), pts, {
        axis: (v) => fmtPrice(v), value: (v) => `${fmtPrice(v)} ${Q}`,
        time: (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + (pts.length && pts[pts.length - 1].t - pts[0].t < 172800 ? " " + new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""),
        full: (t) => new Date(t * 1000).toLocaleString(),
      });
      $("#tTrades").innerHTML = swaps.length ? swaps.slice(-25).reverse().map((s) => {
        const link = state.be.explorerTx(s.tx);
        return `<tr><td class="${s.isBuy ? "up" : "down"}">${s.isBuy ? "Buy" : "Sell"}</td><td>${fmtCompact(toNum(s.quoteAmount))}</td><td>${fmtCompact(toNum(s.tokenAmount))}</td><td>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${short(s.trader)}</a>` : short(s.trader)}</td><td class="faint">${ago(s.ts)}</td></tr>`;
      }).join("") : `<tr><td colspan="5" class="faint">No trades yet. Be the first.</td></tr>`;
      renderHead();
    }

    let bal = null;
    async function refreshBal() {
      try { bal = await state.be.balances(l); } catch { bal = null; }
      if ($("#tTrade")) renderTrade();
    }

    // MAX stores the exact wei amount so no dust is left behind by display rounding
    const readIn = () => { const i = $("#tIn"); return i.dataset.exact ? BigInt(i.dataset.exact) : parseAmount(i.value); };
    const clearIn = () => { const i = $("#tIn"); if (i) { i.value = ""; delete i.dataset.exact; } };
    let quoteSeq = 0;
    async function renderTrade() {
      if (!$("#tTrade")) return;
      const inSym = mode === "buy" ? Q : l.symbol, outSym = mode === "buy" ? l.symbol : Q;
      $("#tInSym").textContent = inSym; $("#tOutSym").textContent = outSym;
      const inBal = bal ? (mode === "buy" ? bal.quote : bal.token) : null;
      const outBal = bal ? (mode === "buy" ? bal.token : bal.quote) : null;
      $("#tBalIn").innerHTML = inBal === null ? "" : `Balance ${fmtCompact(toNum(inBal))} <button type="button" class="amount__max" id="tMax">MAX</button>`;
      $("#tBalOut").textContent = outBal === null ? "" : `Balance ${fmtCompact(toNum(outBal))}`;
      if ($("#tMax")) $("#tMax").onclick = () => {
        let v = inBal;
        if (mode === "buy" && isNative(l) && !state.be.demo) v = v > ethers.parseEther("0.02") ? v - ethers.parseEther("0.02") : 0n;
        $("#tIn").value = trimNum(v, 8); $("#tIn").dataset.exact = v.toString(); renderTrade();
      };
      const amt = readIn();
      const go = $("#tGo");
      const seq = ++quoteSeq;
      let out = 0n;
      if (amt && amt > 0n) {
        try { out = mode === "buy" ? await state.be.quoteBuy(l, amt) : await state.be.quoteSell(l, amt); } catch { out = 0n; }
      }
      if (seq !== quoteSeq || !$("#tTrade") || !go.isConnected) return; // stale or navigated away
      $("#tOut").value = out > 0n ? trimNum(out, 6) : "";
      const p0 = priceOf(l);
      const exec = amt && out ? (mode === "buy" ? toNum(amt) / toNum(out) : toNum(out) / toNum(amt)) : 0;
      const impact = exec && p0 ? Math.abs(exec / p0 - 1) * 100 : 0;
      const minOut = (out * BigInt(Math.round((100 - slip) * 100))) / 10000n;
      $("#tInfo").innerHTML = amt && out ? [
        ["Rate", `1 ${esc(l.symbol)} ≈ ${fmtPrice(exec)} ${esc(Q)}`],
        ["Price impact", `<span class="${impact > 5 ? "down" : ""}">${impact.toFixed(2)}%</span>`],
        ["Minimum received", `${fmtCompact(toNum(minOut))} ${esc(outSym)}`],
      ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("") : "";
      go.disabled = false;
      if (!state.be.account) { go.innerHTML = "Connect wallet"; go.dataset.act = "connect"; return; }
      go.dataset.act = "trade";
      if (!amt) { go.textContent = "Enter an amount"; go.disabled = true; return; }
      if (inBal !== null && amt > inBal) { go.textContent = `Insufficient ${inSym}`; go.disabled = true; return; }
      if (!out) { go.textContent = "Amount too small"; go.disabled = true; return; }
      go.textContent = `${mode === "buy" ? "Buy" : "Sell"} ${l.symbol}`;
      go.dataset.min = minOut.toString();
    }

    $$("#tMode button").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.m; $$("#tMode button").forEach((x) => x.classList.toggle("is-on", x === b));
      clearIn(); renderTrade();
    }));
    $$(".slip button").forEach((b) => b.addEventListener("click", () => {
      slip = Number(b.dataset.s); ls.set("tf-slip", String(slip));
      $$(".slip button").forEach((x) => x.classList.toggle("is-on", x === b)); renderTrade();
    }));
    $("#tIn").addEventListener("input", (e) => {
      delete e.target.dataset.exact;
      const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
      if (v !== e.target.value) e.target.value = v;
      renderTrade();
    });
    $("#tGo").addEventListener("click", async () => {
      const go = $("#tGo");
      if (go.dataset.act === "connect") { await connect(); await refreshBal(); return; }
      const amt = readIn();
      if (!amt) return;
      const min = BigInt(go.dataset.min || "0");
      go.disabled = true;
      const t = toast("wait", mode === "buy" ? "Buying…" : "Selling…", "Preparing transaction", 0);
      try {
        if (mode === "buy") await state.be.buy(l, amt, min, (m) => t.set(mode === "buy" ? "Buying…" : "Selling…", m));
        else await state.be.sell(l, amt, min, (m) => t.set("Selling…", m));
        t.set("Trade confirmed", `${mode === "buy" ? "Bought" : "Sold"} $${l.symbol}.`, "ok"); setTimeout(t.kill, 4000);
        state.launches = null;
        updateWallet();
        if (!$("#tIn")) return; // user navigated away while the trade was pending
        clearIn();
        l = await state.be.get(l.token);
        await Promise.all([loadSwaps(), refreshBal()]);
      } catch (e) {
        console.warn(e);
        t.set("Trade failed", B.friendlyError(e), "err"); setTimeout(t.kill, 7000);
      }
      renderTrade();
    });
    const onWallet = () => { if ($("#tTrade")) refreshBal(); };
    onView("tf:wallet", onWallet);
    onView("tf:price", () => { if ($("#tPrice")) renderHead(); });

    renderHead();
    renderTrade();
    loadSwaps();
    refreshBal();
  };

  const prose = (eyebrow, title, html) => {
    main.innerHTML = `<section class="page"><div class="wrap"><div class="page__head"><span class="eyebrow reveal">${eyebrow}</span><h1 class="display" data-split style="margin-top:18px">${title}</h1></div>${html}</div></section>`;
    FX.reveals(main);
  };

  views.docs = () => prose("Learn", "How it <em>works.</em>", `<div class="docs-layout">
    <nav class="toc" aria-label="On this page"><a href="#/docs" data-jump="launch">Launching</a><a href="#/docs" data-jump="pool">The pool</a><a href="#/docs" data-jump="fees">Fees</a><a href="#/docs" data-jump="alpha">Alpha pairs</a><a href="#/docs" data-jump="contracts">Contracts</a><a href="#/docs" data-jump="dev">Self-hosting</a></nav>
    <article class="prose reveal">
      <p class="callout">Tensorforge is a set of three small, immutable contracts and a static website. No servers, no custodied funds, no admin keys over your pool.</p>
      <h2 id="launch">Launching</h2>
      <p>A launch is one call to <code>ForgeFactory.createLaunch</code>. In that single transaction the factory:</p>
      <ol><li>deploys a fresh <code>ForgePool</code> for your market;</li><li>deploys your <code>ForgeToken</code>, minting the <em>entire</em> supply straight into that pool;</li><li>moves your initial reserve deposit (TAO or an allow-listed alpha wrapper) into the pool and opens trading.</li></ol>
      <p>The creator starts with zero tokens. If you want a position, you buy it on the same curve as everyone else.</p>
      <h2 id="pool">The pool</h2>
      <p>Each pool is a constant-product market: <code>reserveToken × reserveQuote = k</code>. The starting price is simply your deposit divided by the supply. Buying moves price up the curve, selling moves it down, and the pool can never run out of tokens because each step gets more expensive.</p>
      <p>There are no LP shares and no withdraw function. The initial deposit — plus every fee that stays behind — is locked for as long as the chain exists.</p>
      <h2 id="fees">Fees</h2>
      <ul><li><b>Trading:</b> 1% of the reserve-asset side of every trade. Half (0.5%) goes to the protocol treasury, half stays in the pool and deepens liquidity.</li><li><b>Launch fee:</b> configurable by the factory owner, shown before you sign. Currently displayed on the Create page.</li><li><b>Gas:</b> paid in TAO on Bittensor EVM.</li></ul>
      <h2 id="alpha">Subnet-alpha pairs</h2>
      <p>Subnet alpha lives in Bittensor's staking system, not as an ERC-20. To pair against it, the factory owner allow-lists ERC-20 wrappers that represent staked alpha. Pools launched against a wrapper keep trading even if it is later removed from the list; removal only stops new launches.</p>
      <h2 id="contracts">Contracts</h2>
      <p>Source lives in <code>contracts/</code>: <code>ForgeFactory.sol</code>, <code>ForgePool.sol</code>, <code>ForgeToken.sol</code>. Tokens are plain OpenZeppelin ERC-20s with no owner, mint, pause, blacklist or transfer tax. Pools use checks-effects-interactions, a reentrancy guard, slippage limits and deadlines on every trade.</p>
      <p>Current factory on ${esc(state.net.name)}: <code>${esc(state.be.factory || (state.net.demo ? "simulated in your browser" : "not deployed"))}</code></p>
      <h2 id="dev">Self-hosting</h2>
      <p>The site is plain HTML, CSS and JavaScript — serve the <code>site/</code> folder from anywhere. Deploy the factory with <code>npx hardhat run scripts/deploy.js --network bittensor</code>; the script writes the address into <code>site/js/deployments.js</code> and the site picks it up automatically.</p>
    </article></div>`);

  views.risk = () => prose("Risk disclosure", "Read this <em>first.</em>", `<article class="prose reveal">
    <p class="callout">Tokens launched here are experimental, can be created by anyone, and can lose all of their value. Only use money you can afford to lose.</p>
    <h3>No endorsement</h3><p>Anyone can launch any token. A listing, a "Subnet Coin" label, a netuid or a subnet-alpha pair does not mean the token is affiliated with, endorsed by or issued by Bittensor, the Opentensor Foundation, or any subnet team. Names and images are chosen by creators and can impersonate real projects.</p>
    <h3>Market risk</h3><p>Prices are set purely by trading against a formula. Thin pools move violently. Early buyers — including creators — can sell into later buyers. Locked liquidity prevents the pool from being withdrawn; it does not prevent the price from falling.</p>
    <h3>Reserve-asset risk</h3><p>Alpha pairs depend on a third-party wrapper contract and on the value of the underlying subnet alpha. If the wrapper fails or the alpha loses value, so does the pool's reserve.</p>
    <h3>Smart-contract risk</h3><p>The contracts are small and tested but have not been formally audited. Bugs in the contracts, the chain, your wallet, or this website could lead to loss of funds. Transactions are irreversible.</p>
    <h3>Not advice</h3><p>Nothing here is financial, legal or tax advice. You are responsible for complying with the laws that apply to you.</p>
  </article>`);

  views.fund = () => prose("Fund a wallet", "Get TAO onto <em>EVM.</em>", `<article class="prose reveal">
    <p>Tensorforge runs on Bittensor EVM (chain ID 964). You'll need an EVM wallet such as MetaMask, Rabby or Talisman, and some TAO on the EVM side to pay for liquidity and gas.</p>
    <ol><li>Add Bittensor EVM to your wallet — the Connect button does this automatically.</li><li>Move TAO from your Substrate (ss58) wallet to your EVM (h160) address.</li><li>Come back and launch or trade.</li></ol>
    <ul>${CFG.fundLinks.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> — ${esc(f.note)}</li>`).join("")}</ul>
    <p>Just exploring? Switch to the <b>Demo network</b> from the network picker: you get a funded demo wallet and nothing is real.</p>
  </article>`);

  views.notfound = () => { main.innerHTML = `<section class="page"><div class="wrap">${emptyState("Nothing forged here.", "That page doesn't exist.", '<a class="btn" href="#/">Home</a>')}</div></section>`; FX.reveals(main); };

  // ───────────────────────────── router ─────────────────────────────
  let lastPath = null;
  function route() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    let view = "home", arg;
    if (parts[0] === "markets" || parts[0] === "trade") view = "markets";
    else if (parts[0] === "sectors" && parts[1]) { view = "markets"; params.set("sector", parts[1]); }
    else if (parts[0] === "token" && parts[1]) { view = "token"; arg = parts[1]; }
    else if (["create", "launch"].includes(parts[0])) view = "create";
    else if (["subnets", "docs", "risk", "fund"].includes(parts[0])) view = parts[0];
    else if (parts.length) view = "notfound";

    $$("[data-nav]").forEach((a) => a.classList.toggle("is-active", a.dataset.nav === view));
    closeMenu();
    clearViewListeners();
    const samePage = lastPath === path;
    lastPath = path;
    if (!samePage) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    main.classList.remove("view-enter"); void main.offsetWidth; main.classList.add("view-enter");
    const titles = { home: "Launch tokens paired with TAO", markets: "Discover markets", subnets: "Subnets", create: "Create a market", token: "Market", docs: "Docs", risk: "Risk disclosure", fund: "Fund a wallet", notfound: "Not found" };
    document.title = `Tensorforge — ${titles[view]}`;
    Promise.resolve(views[view](params, arg)).catch((e) => { console.error(e); toast("err", "Something broke", B.friendlyError(e)); });
  }

  // ───────────────────────────── chrome ─────────────────────────────
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  function closeMenu() { nav.classList.remove("is-open"); $("#burger").setAttribute("aria-expanded", "false"); }
  $("#burger").addEventListener("click", () => { const o = !nav.classList.contains("is-open"); nav.classList.toggle("is-open", o); $("#burger").setAttribute("aria-expanded", String(o)); });
  $$(".net-select").forEach((s) => {
    s.innerHTML = CFG.networks.map((n) => `<option value="${n.key}">${esc(n.name)}${!n.demo && !(window.TF_DEPLOYMENTS || {})[String(n.chainId)] ? " (soon)" : ""}</option>`).join("");
    s.addEventListener("change", () => setNet(CFG.networks.find((n) => n.key === s.value)));
  });
  document.addEventListener("click", (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) { e.preventDefault(); const t = document.getElementById(j.dataset.jump); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" }); }
  });
  $("#year").textContent = new Date().getFullYear();
  window.addEventListener("hashchange", route);
  FX.pointerFx();
  onScroll();
  setNet(pickDefaultNet(), { silent: true });
  route();
  loadTaoPrice();
  setInterval(loadTaoPrice, 60_000);

  // exposed for debugging and tests
  window.TF_APP = { state, fmtPrice, fmtCompact, parseAmount, route, setNet };
})();
