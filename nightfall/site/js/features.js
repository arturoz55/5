// Nightfall — notification centre, correlation matrix, 24h range stats and the "Up or down?" game.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };
  const ago = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };

  // ───────────── notification centre ─────────────
  const KEY = "nf-notes";
  const notes = {
    list() { return ls.get(KEY, []); },
    push(kind, title, body) {
      const l = this.list(); l.unshift({ id: Date.now() + Math.random(), kind, title, body, t: Date.now(), read: false });
      ls.set(KEY, l.slice(0, 40)); badge();
    },
    readAll() { ls.set(KEY, this.list().map((n) => ({ ...n, read: true }))); badge(); },
    clear() { ls.set(KEY, []); badge(); },
  };
  function badge() {
    const b = $("#bellCount"); if (!b) return;
    const n = notes.list().filter((x) => !x.read).length;
    b.textContent = n > 9 ? "9+" : String(n); b.hidden = n === 0;
    $("#bell")?.setAttribute("aria-label", n ? `Notifications, ${n} unread` : "Notifications");
  }
  function initBell() {
    const btn = $("#bell"); if (!btn) return;
    badge();
    btn.onclick = () => {
      const open = $(".notes"); if (open) { open.remove(); return; }
      const p = document.createElement("div"); p.className = "notes"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Notifications");
      const render = () => {
        const l = notes.list();
        p.innerHTML = `<div class="notes__head"><b>Notifications</b>${l.length ? '<button class="linkbtn" data-clear>Clear all</button>' : ""}</div>
          ${l.length ? `<ul>${l.map((n) => `<li class="${n.read ? "" : "is-new"}"><i class="notes__dot notes__dot--${esc(n.kind)}"></i><div><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}<small>${ago(n.t)}</small></div></li>`).join("")}</ul>` : `<p class="faint small notes__empty">Nothing yet. Price alerts, liquidations and wallet events show up here.</p>`}`;
        p.querySelector("[data-clear]")?.addEventListener("click", () => { notes.clear(); render(); });
      };
      render();
      document.body.appendChild(p);
      const r = btn.getBoundingClientRect();
      p.style.top = `${r.bottom + 8}px`; p.style.right = `${Math.max(12, innerWidth - r.right)}px`;
      setTimeout(() => notes.readAll(), 600);
      const off = (e) => { if (!p.contains(e.target) && !btn.contains(e.target)) { p.remove(); document.removeEventListener("pointerdown", off); } };
      setTimeout(() => document.addEventListener("pointerdown", off), 0);
    };
  }

  // ───────────── statistics helpers ─────────────
  // align series on a common time grid (step seconds) using the last known price
  function align(seriesList, step = 300) {
    const t0 = Math.max(...seriesList.map((s) => s[0]?.t ?? Infinity)), t1 = Math.min(...seriesList.map((s) => s[s.length - 1]?.t ?? -Infinity));
    if (!isFinite(t0) || !isFinite(t1) || t1 - t0 < step * 4) return null;
    const grid = []; for (let t = t0; t <= t1; t += step) grid.push(t);
    return seriesList.map((s) => { let j = 0; return grid.map((t) => { while (j + 1 < s.length && s[j + 1].t <= t) j++; return s[j].p; }); });
  }
  const returns = (v) => v.slice(1).map((x, i) => Math.log(x / v[i]));
  function corr(a, b) {
    const n = Math.min(a.length, b.length); if (n < 3) return NaN;
    let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
  }
  // 24h high, low and realised volatility (standard deviation of log returns scaled to the window)
  function rangeStats(hist) {
    if (!hist || hist.length < 3) return null;
    const cut = hist[hist.length - 1].t - 86400, pts = hist.filter((p) => p.t >= cut);
    const v = pts.map((p) => p.p), r = returns(v);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
    return { low: Math.min(...v), high: Math.max(...v), open: v[0], last: v[v.length - 1], vol: sd * Math.sqrt(r.length) * 100 };
  }

  function rangePanel(host, hist, fmt) {
    const s = rangeStats(hist);
    if (!s) { host.innerHTML = ""; return; }
    const pos = s.high > s.low ? ((s.last - s.low) / (s.high - s.low)) * 100 : 50;
    const band = s.vol < 1.5 ? ["Calm", "long"] : s.vol < 3.5 ? ["Normal", "cobalt"] : ["Wild", "short"];
    host.innerHTML = `<div class="range">
      <div class="range__labels"><span><small class="label">24h low</small><b class="mono">${fmt(s.low)}</b></span><span class="range__mid"><small class="label">Where it sits</small><b class="mono">${pos.toFixed(0)}% of range</b></span><span style="text-align:right"><small class="label">24h high</small><b class="mono">${fmt(s.high)}</b></span></div>
      <div class="range__bar" role="img" aria-label="Current price at ${pos.toFixed(0)} percent of the 24 hour range"><i style="left:${pos}%"></i></div>
      <div class="range__foot"><span class="faint small">Open ${fmt(s.open)}</span><span class="pill" style="color:var(--${band[1]})" title="Standard deviation of 5-minute log returns, scaled to 24 hours">Volatility ${s.vol.toFixed(2)}% · ${band[0]}</span></div>
    </div>`;
  }

  // ───────────── correlation matrix ─────────────
  function correlation(host, markets, histories, onPick) {
    const al = align(histories.map((h) => h || []));
    if (!al) { host.innerHTML = `<p class="faint small">Not enough overlapping history yet.</p>`; return; }
    const R = al.map(returns), n = markets.length;
    const M = markets.map((_, i) => markets.map((__, j) => (i === j ? 1 : corr(R[i], R[j]))));
    const color = (c) => {
      if (!isFinite(c)) return "var(--bg-3)";
      const a = Math.min(1, Math.abs(c));
      return c >= 0 ? `color-mix(in srgb, var(--cobalt) ${Math.round(15 + a * 75)}%, var(--bg-3))` : `color-mix(in srgb, var(--warn) ${Math.round(15 + a * 75)}%, var(--bg-3))`;
    };
    host.innerHTML = `<div class="corr" style="--n:${n}">
      <span></span>${markets.map((m) => `<span class="corr__h">${esc(m.symbol)}</span>`).join("")}
      ${markets.map((a, i) => `<span class="corr__h corr__h--row">${esc(a.symbol)}</span>${markets.map((b, j) => `<button class="corr__c" data-i="${i}" data-j="${j}" style="background:${color(M[i][j])}" aria-label="${esc(a.symbol)} and ${esc(b.symbol)}: correlation ${isFinite(M[i][j]) ? M[i][j].toFixed(2) : "unknown"}">${i === j ? "" : isFinite(M[i][j]) ? M[i][j].toFixed(1).replace("0.", ".").replace("-.", "−.") : "–"}</button>`).join("")}`).join("")}
    </div><p class="corr__read faint small" id="corrRead">Hover a cell to read it. Click one to compare the two markets.</p>`;
    const read = $("#corrRead", host);
    $$(".corr__c", host).forEach((c) => {
      const i = +c.dataset.i, j = +c.dataset.j, v = M[i][j];
      const words = i === j ? "is the same market" : !isFinite(v) ? "has too little data" : Math.abs(v) < 0.2 ? "move mostly independently" : v > 0.6 ? "tend to move together strongly" : v > 0.2 ? "tend to move together" : v < -0.6 ? "tend to move strongly in opposite directions" : "tend to move in opposite directions";
      const show = () => { read.innerHTML = `<b>${esc(markets[i].symbol)} and ${esc(markets[j].symbol)}</b> ${words}${i !== j && isFinite(v) ? ` (correlation ${v.toFixed(2)})` : ""}.`; };
      c.addEventListener("mouseenter", show); c.addEventListener("focus", show);
      c.addEventListener("click", () => i !== j && onPick && onPick(i, j));
    });
  }

  // ───────────── "Up or down?" game ─────────────
  function game(host, api) {
    const S = ls.get("nf-game", { streak: 0, best: 0, played: 0, won: 0 });
    let round = null;
    const render = () => {
      const ms = api.markets();
      host.innerHTML = `<div class="game">
        <div class="grid2"><div class="field"><label class="label" for="gMarket">Market</label><div class="amount"><select id="gMarket">${ms.map((m) => `<option value="${m.id}">${esc(m.symbol)} · ${esc(m.name)}</option>`).join("")}</select></div></div>
        <div class="field"><span class="label">Your call for the next 15 seconds</span><div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn btn--jade" id="gUp" style="flex:1">▲ Up</button><button class="btn btn--cinnabar" id="gDown" style="flex:1">▼ Down</button></div></div></div>
        <div class="game__stage" id="gStage"><p class="faint">Pick a direction to start a round.</p></div>
        <div class="game__score"><span><small class="label">Streak</small><b class="mono" id="gStreak">${S.streak}</b></span><span><small class="label">Best</small><b class="mono" id="gBest">${S.best}</b></span><span><small class="label">Won</small><b class="mono">${S.won}/${S.played}</b></span><button class="linkbtn" id="gReset">Reset score</button></div>
        <p class="faint small" style="margin:10px 0 0">Just for fun: no money, no wallet, and scores stay in this browser. A tie counts as a loss.</p>
      </div>`;
      $("#gUp", host).onclick = () => start("up");
      $("#gDown", host).onclick = () => start("down");
      $("#gReset", host).onclick = () => { Object.assign(S, { streak: 0, best: 0, played: 0, won: 0 }); ls.set("nf-game", S); render(); };
    };
    function start(dir) {
      if (round) return;
      const id = Number($("#gMarket", host).value), m = api.markets()[id];
      const p0 = Number(m.price) / 1e8, end = Date.now() + 15000;
      round = { dir, id, p0, end };
      $$("#gUp, #gDown, #gMarket", host).forEach((b) => (b.disabled = true));
      const tick = () => {
        if (!host.isConnected) { round = null; return; }
        const now = Number(api.markets()[id].price) / 1e8, left = Math.max(0, Math.ceil((round.end - Date.now()) / 1000));
        const chg = ((now - p0) / p0) * 100;
        $("#gStage", host).innerHTML = `<div class="game__live"><div class="game__ring" style="--p:${((15 - left) / 15) * 100}"><b class="mono">${left}s</b></div>
          <div><div class="label">${esc(m.symbol)} · you said ${dir === "up" ? "▲ up" : "▼ down"}</div><div class="mono game__px">$${now.toFixed(now < 10 ? 3 : 2)} <span class="${chg >= 0 ? "long" : "short"}">${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(3)}%</span></div><div class="faint small">Started at $${p0.toFixed(p0 < 10 ? 3 : 2)}</div></div></div>`;
        if (left > 0) { round.timer = setTimeout(tick, 250); return; }
        const won = (dir === "up" && now > p0) || (dir === "down" && now < p0);
        S.played++; if (won) { S.won++; S.streak++; S.best = Math.max(S.best, S.streak); } else S.streak = 0;
        ls.set("nf-game", S);
        round = null;
        render();
        $("#gStage", host).innerHTML = `<div class="game__result ${won ? "is-win" : "is-loss"}"><b>${won ? "You called it." : now === p0 ? "No move, so that's a tie (counts as a loss)." : "Not this time."}</b><span class="mono">${esc(m.symbol)} ${((now - p0) / p0 * 100 >= 0 ? "+" : "−") + Math.abs(((now - p0) / p0) * 100).toFixed(3)}% in 15 s</span></div>`;
        api.onResult && api.onResult(won, m.symbol, S.streak);
      };
      tick();
    }
    render();
  }

  window.NF_FEAT = { notes, initBell, rangePanel, rangeStats, correlation, game, align, corr };
})();
