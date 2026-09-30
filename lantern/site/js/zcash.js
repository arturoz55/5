// Lantern — Zcash corner: interactive explainers about ZEC privacy and issuance.
// Everything here is computed locally from Zcash's published consensus schedule;
// nothing is fetched and nothing touches a wallet.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  function fit(c) {
    const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0); return { ctx, w: r.width, h: r.height };
  }

  // ───────────── issuance schedule (consensus rules) ─────────────
  // Slow start: reward ramps linearly over the first 20,000 blocks to 12.5 ZEC.
  // 150 s blocks until Blossom (block 653,600), then 75 s blocks with the per-block reward halved to 6.25.
  // Halvings every 1,680,000 blocks after that: 1,046,400 (Nov 2020), 2,726,400 (Nov 2024), 4,406,400, …
  const SLOW = 20000, BLOSSOM = 653600, H1 = 1046400, INTERVAL = 1680000, MAX = 21e6;
  const halvingHeight = (k) => H1 + (k - 1) * INTERVAL; // k = 1, 2, 3…
  function rewardAt(h) {
    if (h < SLOW) return (12.5 * h) / SLOW;
    if (h < BLOSSOM) return 12.5;
    if (h < H1) return 6.25;
    const k = Math.floor((h - H1) / INTERVAL) + 1;
    return 6.25 / 2 ** k;
  }
  function issuedAt(h) {
    let s = 0;
    const ramp = Math.min(h, SLOW); s += (12.5 * ramp * ramp) / (2 * SLOW);
    if (h > SLOW) s += (Math.min(h, BLOSSOM) - SLOW) * 12.5;
    if (h > BLOSSOM) s += (Math.min(h, H1) - BLOSSOM) * 6.25;
    for (let k = 1, start = H1; h > start; k++, start += INTERVAL) s += (Math.min(h, start + INTERVAL) - start) * (6.25 / 2 ** k);
    return Math.min(s, MAX);
  }
  // Height ↔ time, anchored on known activation dates; after the last anchor, 75 s per block.
  const ANCHORS = [
    [0, Date.UTC(2016, 9, 28)], [BLOSSOM, Date.UTC(2019, 11, 11)], [H1, Date.UTC(2020, 10, 18)], [halvingHeight(2), Date.UTC(2024, 10, 23)],
  ];
  function heightAt(ms) {
    for (let i = ANCHORS.length - 1; i >= 0; i--) {
      const [h, t] = ANCHORS[i];
      if (ms >= t) {
        if (i < ANCHORS.length - 1) { const [h2, t2] = ANCHORS[i + 1]; return Math.round(h + ((ms - t) / (t2 - t)) * (h2 - h)); }
        return Math.round(h + (ms - t) / 75000);
      }
    }
    return 0;
  }
  const timeAt = (h) => { const [h0, t0] = ANCHORS[ANCHORS.length - 1]; if (h >= h0) return t0 + (h - h0) * 75000; for (let i = ANCHORS.length - 1; i > 0; i--) { const [ha, ta] = ANCHORS[i - 1], [hb, tb] = ANCHORS[i]; if (h >= ha) return ta + ((h - ha) / (hb - ha)) * (tb - ta); } return ANCHORS[0][1]; };

  // ───────────── address inspector (format only) ─────────────
  const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/, BECH = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
  function inspect(raw) {
    const a = raw.trim();
    if (!a) return null;
    const lower = a.toLowerCase();
    const out = (type, pool, ok, note) => ({ type, pool, ok, note });
    if (/^t1/.test(a)) return out("Transparent (P2PKH)", "Transparent", a.length === 35 && B58.test(a), "Balances and amounts are public, like Bitcoin.");
    if (/^t3/.test(a)) return out("Transparent (P2SH, script)", "Transparent", a.length === 35 && B58.test(a), "Often a multisig. Everything is visible on chain.");
    if (/^tm|^t2/.test(a)) return out("Transparent (testnet)", "Testnet", a.length === 35 && B58.test(a), "Testnet address. Its coins have no value.");
    if (/^zs1/.test(lower)) return out("Sapling shielded", "Sapling", a.length === 78 && BECH.test(lower.slice(3)), "Sender, receiver, amount and memo are encrypted.");
    if (/^ztestsapling1/.test(lower)) return out("Sapling shielded (testnet)", "Testnet", BECH.test(lower.slice(13)), "Testnet shielded address.");
    if (/^u1/.test(lower)) return out("Unified address", "Orchard / Sapling / transparent", a.length >= 100 && BECH.test(lower.slice(2)), "Bundles several receivers. Modern wallets pick the most private one automatically.");
    if (/^zc/.test(a)) return out("Sprout shielded (legacy)", "Sprout", a.length === 95 && B58.test(a), "The original shielded pool. It's deprecated, so move funds out.");
    return out("Not a Zcash address", "—", false, "Zcash addresses start with t1, t3, zs1, u1 or zc.");
  }

  // ───────────── view ─────────────
  function render(main, api) {
    main.innerHTML = `<section class="page"><div class="wrap">
      <div class="zhero">
        <div>
          <span class="kicker">Zcash corner</span>
          <h1 class="h2" style="font-size:clamp(38px,5.4vw,72px)">Privacy you can<br><span style="color:var(--zec)">verify</span>.</h1>
          <p class="lead" style="margin-top:14px">Zcash (ZEC) is a cryptocurrency that can hide who paid whom, and how much, while the network still proves every payment is valid. It does this with zero-knowledge proofs (zk-SNARKs). Try it below. Everything runs in your browser.</p>
          <div class="row" style="margin-top:22px"><a class="btn btn--zec" href="#zc-tx" data-jump="zc-tx">Build a transaction</a><a class="btn btn--ghost" href="#zc-supply" data-jump="zc-supply">Supply & halvings</a></div>
        </div>
        <div class="zshield" aria-hidden="true"><canvas id="zShield"></canvas></div>
      </div>

      <div class="tools" style="margin-top:28px">
        <section class="panel tool wide" id="zc-tx"><span class="label">Interactive</span><h2>What does the world see?</h2>
          <p>Pick where the money comes from and where it goes. The right side shows what anyone reading the public blockchain learns.</p>
          <div class="ztx">
            <div class="ztx__form">
              <div class="grid2">
                <div class="field"><span class="label">From</span><div class="seg" id="zFrom"><button type="button" data-v="t" class="on">Transparent</button><button type="button" data-v="z">Shielded</button></div></div>
                <div class="field"><span class="label">To</span><div class="seg" id="zTo"><button type="button" data-v="t">Transparent</button><button type="button" data-v="z" class="on">Shielded</button></div></div>
              </div>
              <div class="grid2">
                <div class="field"><label class="label" for="zAmt">Amount</label><div class="amount"><input id="zAmt" inputmode="decimal" value="12.5"><span>ZEC</span></div></div>
                <div class="field"><label class="label" for="zMemo">Encrypted memo</label><div class="amount"><input id="zMemo" maxlength="80" value="rent for October" style="font-size:15px"></div></div>
              </div>
              <p class="faint small" style="margin:14px 0 0" id="zKind"></p>
            </div>
            <div class="ztx__view" aria-live="polite">
              <div class="ztx__bar"><span class="label">Public block explorer</span><span class="pill" id="zPriv"></span></div>
              <dl class="zrows" id="zRows"></dl>
            </div>
          </div>
        </section>

        <section class="panel tool" id="zc-addr"><span class="label">Tool</span><h2>Address inspector</h2>
          <p>Paste a Zcash address to see what kind it is. This checks the format only, not the checksum, and nothing is sent anywhere.</p>
          <div class="field"><label class="label" for="zAddr">Address</label><div class="amount"><input id="zAddr" placeholder="t1…, zs1…, u1…" autocomplete="off" spellcheck="false" style="font-size:14px"></div></div>
          <div class="row" style="margin-top:10px;gap:6px"><span class="faint small">Try an example:</span><button class="chipbtn" data-ex="t1">t1</button><button class="chipbtn" data-ex="zs1">zs1</button><button class="chipbtn" data-ex="u1">u1</button></div>
          <div class="result" id="zAddrOut"><div><dt>Waiting for an address.</dt></div></div>
        </section>

        <section class="panel tool" id="zc-quiz"><span class="label">Quiz</span><h2>Private or public?</h2><p>Three quick questions. Pick an answer to see why.</p><div id="zQuiz"></div></section>

        <section class="panel tool wide" id="zc-supply"><span class="label">Issuance</span><h2>Supply and halvings</h2>
          <p>New ZEC is created with every block, and the reward halves about every four years until supply approaches 21 million. Drag the slider, or across the chart, to move through time.</p>
          <div class="mini-chart" style="height:240px"><canvas id="zChart" aria-label="ZEC issued over time"></canvas></div>
          <div class="field"><label class="label" for="zDate">Date <b class="mono" id="zDateV"></b></label><input type="range" class="lev" id="zDate" min="0" max="1000" value="0"></div>
          <div class="stats" style="margin-top:16px" id="zStats">${["Block height", "Reward per block", "ZEC issued", "Next halving"].map((k) => `<div class="stat"><span class="label">${k}</span><div class="stat__v">—</div><div class="stat__s"></div></div>`).join("")}</div>
          <p class="faint small" style="margin:12px 0 0">Heights after November 2024 assume the 75-second target block time, so they are estimates. The schedule follows the consensus rules: a slow start over the first 20,000 blocks, Blossom in December 2019, and halvings every 1,680,000 blocks after that.</p>
        </section>
      </div>
      <p class="note" style="margin-top:22px">Lantern doesn't offer ZEC trading. This page is educational and isn't investment advice.</p>
    </div></section>`;

    $$("[data-jump]", main).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (t) scrollTo({ top: t.getBoundingClientRect().top + scrollY - 90, behavior: "smooth" }); }));
    shield($("#zShield"));
    txDemo(); addrTool(); quiz(); supply();

    // ── transaction visualiser ──
    function txDemo() {
      let from = "t", to = "z";
      const seg = (id, set) => $$(`#${id} button`).forEach((b) => (b.onclick = () => { $$(`#${id} button`).forEach((x) => x.classList.toggle("on", x === b)); set(b.dataset.v); upd(); }));
      seg("zFrom", (v) => (from = v)); seg("zTo", (v) => (to = v));
      $("#zAmt").oninput = upd; $("#zMemo").oninput = upd;
      const addr = { t: "t1Vz…8kQm", z: "zs1…(encrypted)" };
      function scramble(el, text, hidden) {
        if (!hidden) { el.textContent = text; el.classList.remove("is-hidden"); return; }
        el.classList.add("is-hidden");
        const chars = "█▓▒░#%&*";
        let n = 0;
        const t = setInterval(() => { el.textContent = Array.from({ length: Math.max(6, Math.min(18, text.length)) }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); if (++n > 8) { clearInterval(t); el.textContent = "encrypted"; } }, 45);
      }
      function upd() {
        const amt = parseFloat($("#zAmt").value) || 0, memo = $("#zMemo").value;
        const kinds = { tt: ["Fully transparent", "Works like Bitcoin: everything is public.", "short"], tz: ["Shielding", "The sender and amount are visible; where the money goes is hidden.", "warn"], zt: ["Deshielding", "The recipient and amount are visible; where the money came from is hidden.", "warn"], zz: ["Fully shielded", "Only a fee and an encrypted blob are public. This is Zcash's strongest privacy.", "long"] };
        const [kind, desc, tone] = kinds[from + to];
        $("#zKind").innerHTML = `<b>${kind}.</b> ${desc}`;
        $("#zPriv").textContent = kind; $("#zPriv").style.color = `var(--${tone})`;
        const rows = [
          ["Sender", addr[from], from === "z"], ["Receiver", addr[to], to === "z"],
          ["Amount", `${fmt(amt, 4)} ZEC`, from === "z" && to === "z"], ["Memo", to === "z" ? `"${memo}"` : "not supported to transparent addresses", to === "z"],
          ["Network fee", "0.0001 ZEC", false], ["Validity proof", from === "z" || to === "z" ? "zk-SNARK ✓ verified" : "signature ✓ verified", false],
        ];
        $("#zRows").innerHTML = rows.map(([k]) => `<div><dt>${k}</dt><dd></dd></div>`).join("");
        $$("#zRows dd").forEach((dd, i) => scramble(dd, rows[i][1], rows[i][2]));
      }
      upd();
    }

    // ── address inspector ──
    function addrTool() {
      // format-valid examples built from the right alphabets (not real wallets)
      const ex = {
        t1: "t1" + "Rb3Nq7LkX2vFz9Wm4YpHd8sTe6Uc5GaJk",
        zs1: "zs1" + "q9x8f2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0",
        u1: "u1" + "qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(4),
      };
      const out = (r) => {
        if (!r) { $("#zAddrOut").innerHTML = `<div><dt>Waiting for an address.</dt></div>`; return; }
        $("#zAddrOut").innerHTML = [["Type", `<b>${esc(r.type)}</b>`], ["Pool", esc(r.pool)], ["Format", r.ok ? '<span class="long">Looks valid</span>' : '<span class="short">Doesn\'t match the expected format</span>'], ["What it means", esc(r.note)]].map(([a, b]) => `<div><dt>${a}</dt><dd style="text-align:right;max-width:65%">${b}</dd></div>`).join("");
      };
      $("#zAddr").oninput = (e) => out(inspect(e.target.value));
      $$("[data-ex]").forEach((b) => (b.onclick = () => { $("#zAddr").value = ex[b.dataset.ex]; out(inspect(ex[b.dataset.ex])); }));
    }

    // ── quiz ──
    function quiz() {
      const Q = [
        ["Alice sends ZEC from a zs1… address to another zs1… address. Can a block explorer see the amount?", ["Yes", "No"], 1, "Between two shielded addresses the amount is encrypted. The explorer only sees that a valid transaction happened, plus its fee."],
        ["Bob pays a t1… address from his shielded wallet. What becomes public?", ["Nothing at all", "The recipient and the amount"], 1, "Deshielding reveals the transparent side: who received the funds and how much. Bob's shielded address stays hidden."],
        ["Is total ZEC supply still auditable if many payments are private?", ["Yes, the proofs guarantee no coins are created from nothing", "No, nobody can check it"], 0, "Every shielded payment includes a zero-knowledge proof that its value balances, and each shielded pool's total is tracked on chain."],
      ];
      let score = 0, done = 0;
      $("#zQuiz").innerHTML = Q.map(([q, opts], i) => `<div class="zq" data-q="${i}"><p>${esc(q)}</p><div class="row" style="gap:6px">${opts.map((o, j) => `<button class="chipbtn" data-a="${j}">${esc(o)}</button>`).join("")}</div><p class="zq__why faint small" hidden></p></div>`).join("") + `<p class="mono small" id="zScore" style="margin:12px 0 0"></p>`;
      $$("#zQuiz .zq").forEach((el) => $$("[data-a]", el).forEach((b) => (b.onclick = () => {
        if (el.dataset.done) return;
        const i = Number(el.dataset.q), right = Number(b.dataset.a) === Q[i][2];
        el.dataset.done = "1"; done++; if (right) score++;
        b.classList.add("on"); b.style.background = `var(--${right ? "long" : "short"})`;
        const why = $(".zq__why", el); why.hidden = false; why.textContent = `${right ? "Correct." : "Not quite."} ${Q[i][3]}`;
        $("#zScore").textContent = done === Q.length ? `You got ${score} of ${Q.length} right.` : "";
      })));
    }

    // ── supply chart + date slider ──
    function supply() {
      const t0 = ANCHORS[0][1], t1 = Date.UTC(2040, 0, 1), now = Date.now();
      const slider = $("#zDate");
      slider.value = Math.round(((now - t0) / (t1 - t0)) * 1000);
      let sel = now;
      const draw = () => {
        const c = $("#zChart"); if (!c) return;
        const { ctx, w, h } = fit(c);
        const L = 56, B = 22, T = 10, R = 10;
        const X = (t) => L + ((t - t0) / (t1 - t0)) * (w - L - R), Y = (v) => T + (1 - v / MAX) * (h - T - B);
        ctx.clearRect(0, 0, w, h);
        ctx.font = "11px 'DM Mono', monospace"; ctx.fillStyle = css("--ink-3"); ctx.strokeStyle = css("--line");
        for (const v of [0, 5e6, 10.5e6, 15.75e6, 21e6]) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke(); ctx.fillText(`${(v / 1e6).toFixed(v % 1e6 ? 2 : 0)}M`, 4, Y(v) + 4); }
        for (let y = 2017; y <= 2039; y += 4) { const x = X(Date.UTC(y, 0, 1)); ctx.fillText(String(y), x - 14, h - 5); }
        // halvings
        ctx.setLineDash([3, 4]); ctx.strokeStyle = css("--zec");
        for (let k = 1; k <= 4; k++) { const x = X(timeAt(halvingHeight(k))); if (x > w - R) break; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.fillStyle = css("--zec"); ctx.fillText(`H${k}`, x + 3, T + 10); }
        ctx.setLineDash([]);
        // issuance curve
        ctx.beginPath();
        for (let px = 0; px <= w - L - R; px += 2) { const t = t0 + (px / (w - L - R)) * (t1 - t0); const v = issuedAt(heightAt(t)); px ? ctx.lineTo(L + px, Y(v)) : ctx.moveTo(L + px, Y(v)); }
        ctx.strokeStyle = css("--zec"); ctx.lineWidth = 2.2; ctx.stroke(); ctx.lineWidth = 1;
        // now + selection
        ctx.fillStyle = css("--ink-3"); ctx.fillRect(X(now) - 0.5, T, 1, h - T - B); ctx.fillText("today", X(now) + 4, h - B - 6);
        const sv = issuedAt(heightAt(sel));
        ctx.fillStyle = css("--zec"); ctx.beginPath(); ctx.arc(X(sel), Y(sv), 6, 0, 7); ctx.fill();
        ctx.strokeStyle = css("--bg"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
        c._X = X;
      };
      const stats = () => {
        const hgt = heightAt(sel), r = rewardAt(hgt), iss = issuedAt(hgt);
        let k = 1; while (halvingHeight(k) <= hgt) k++;
        const nextH = halvingHeight(k), nextT = timeAt(nextH), days = Math.round((nextT - sel) / 864e5);
        const vals = [[fmt(hgt), sel > ANCHORS[3][1] ? "estimated" : "from anchors"], [`${r >= 1 ? fmt(r, r % 1 ? 4 : 2) : r.toFixed(5)} ZEC`, `≈ ${fmt(r * 1152, 0)} ZEC per day`], [`${fmt(iss / 1e6, 3)}M`, `${((iss / MAX) * 100).toFixed(2)}% of 21M`], [`#${fmt(nextH)}`, days > 0 ? `in about ${fmt(days)} days (${new Date(nextT).toLocaleDateString(undefined, { month: "short", year: "numeric" })})` : "—"]];
        $$("#zStats .stat").forEach((s, i) => { $(".stat__v", s).textContent = vals[i][0]; $(".stat__s", s).textContent = vals[i][1]; });
        $("#zDateV").textContent = new Date(sel).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + (Math.abs(sel - now) < 864e5 ? " · today" : "");
      };
      const set = (t) => { sel = Math.max(t0, Math.min(t1, t)); slider.value = Math.round(((sel - t0) / (t1 - t0)) * 1000); draw(); stats(); };
      slider.oninput = () => { sel = t0 + (Number(slider.value) / 1000) * (t1 - t0); draw(); stats(); };
      const c = $("#zChart"); let drag = false;
      const fromX = (e) => { const r = c.getBoundingClientRect(); const L = 56, R = 10; return t0 + ((e.clientX - r.left - L) / (r.width - L - R)) * (t1 - t0); };
      c.style.touchAction = "none";
      c.addEventListener("pointerdown", (e) => { drag = true; c.setPointerCapture(e.pointerId); set(fromX(e)); });
      c.addEventListener("pointermove", (e) => drag && set(fromX(e)));
      c.addEventListener("pointerup", () => (drag = false));
      new ResizeObserver(draw).observe(c);
      document.addEventListener("ln:theme", () => c.isConnected && draw());
      set(now);
    }
  }

  // a slowly turning shield made of rings, drawn in the Zcash gold
  function shield(c) {
    let a = 0, raf = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = () => {
      raf = 0;
      if (!c.isConnected) return;
      const { ctx, w, h } = fit(c), cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42, gold = css("--zec") || "#f4b728";
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 18; i++) {
        const t = i / 18, rr = R * (0.35 + t * 0.65);
        ctx.strokeStyle = gold; ctx.globalAlpha = 0.15 + (1 - t) * 0.5; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * Math.abs(Math.cos(a + t * 3)), a * 0.3 + t, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // the ⓩ-style mark: a circle with a Z and two bars (original drawing, not the official logo)
      ctx.lineWidth = Math.max(3, R * 0.06); ctx.strokeStyle = gold; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.34, 0, 7); ctx.stroke();
      const s = R * 0.16;
      ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.lineTo(cx + s, cy + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - s * 1.7); ctx.lineTo(cx, cy - s); ctx.moveTo(cx, cy + s); ctx.lineTo(cx, cy + s * 1.7); ctx.stroke();
      if (!reduce) { a += 0.006; raf = requestAnimationFrame(frame); }
    };
    frame();
  }

  window.LN_ZCASH = { render, inspect, issuedAt, rewardAt, heightAt, halvingHeight };
})();
