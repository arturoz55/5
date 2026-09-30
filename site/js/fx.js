// Visual effects: hero lattice, charts, reveals, pointer glow, tilt, counters.
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

  function fitCanvas(c) {
    const r = c.getBoundingClientRect();
    const d = DPR();
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w: r.width, h: r.height, d };
  }

  // ── Hero: a slowly rotating 3D lattice of "neurons" with embers rising through it ──
  function heroLattice(canvas) {
    const ctx = canvas.getContext("2d");
    const N = window.innerWidth < 700 ? 70 : 140;
    const pts = [];
    for (let i = 0; i < N; i++) {
      // points on a noisy sphere shell
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 0.75 + Math.random() * 0.35;
      const s = Math.sqrt(1 - u * u);
      pts.push({ x: s * Math.cos(t) * r, y: u * r, z: s * Math.sin(t) * r, p: Math.random() * Math.PI * 2 });
    }
    const embers = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), v: 0.0006 + Math.random() * 0.0016, s: Math.random() * 1.6 + 0.4, w: Math.random() * Math.PI * 2 }));
    let mx = 0, my = 0, tx = 0, ty = 0, raf = 0, visible = true, t0 = performance.now();
    const onMove = (e) => { tx = (e.clientX / window.innerWidth - 0.5); ty = (e.clientY / window.innerHeight - 0.5); };
    window.addEventListener("pointermove", onMove, { passive: true });
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !raf) loop(); }, { threshold: 0 });
    io.observe(canvas);

    function frame(now) {
      const { w, h, d } = fitCanvas(canvas);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = Math.max(0, (now - t0) / 1000);
      mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
      const ay = t * 0.08 + mx * 0.8, ax = 0.35 + my * 0.5;
      const cx = w * (w > 900 ? 0.68 : 0.5), cy = h * 0.46, R = Math.min(w, h) * (w > 900 ? 0.42 : 0.5);
      const ca = Math.cos(ay), sa = Math.sin(ay), cb = Math.cos(ax), sb = Math.sin(ax);
      const proj = pts.map((p) => {
        const breathe = 1 + Math.sin(t * 0.9 + p.p) * 0.025;
        let x = p.x * breathe, y = p.y * breathe, z = p.z * breathe;
        const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
        const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
        const f = 2.4 / (2.4 + z2);
        return { x: cx + x1 * R * f, y: cy + y1 * R * f, z: z2, f };
      });
      // connections
      ctx.lineWidth = 1;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i];
        for (let j = i + 1; j < proj.length; j++) {
          const b = proj[j];
          const dx = a.x - b.x, dy = a.y - b.y, dist = dx * dx + dy * dy, lim = (R * 0.28) ** 2;
          if (dist < lim) {
            const depth = (2 - (a.z + b.z)) / 4;
            const al = (1 - dist / lim) * 0.28 * depth;
            ctx.strokeStyle = `rgba(239,232,220,${al})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      // pulses travelling along a few edges
      for (let k = 0; k < 6; k++) {
        const a = proj[(k * 23 + Math.floor(t * 0.5)) % proj.length], b = proj[(k * 37 + 11 + Math.floor(t * 0.5)) % proj.length];
        const ph = (t * 0.5) % 1;
        const x = a.x + (b.x - a.x) * ph, y = a.y + (b.y - a.y) * ph;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, "rgba(255,154,77,.9)"); g.addColorStop(1, "rgba(255,106,43,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
      }
      // nodes
      for (const p of proj) {
        const depth = (1.2 - p.z) / 2.2;
        ctx.fillStyle = p.z < -0.3 ? `rgba(255,122,58,${0.5 + depth * 0.5})` : `rgba(239,232,220,${0.25 + depth * 0.6})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + p.f * 1.4 * depth, 0, Math.PI * 2); ctx.fill();
      }
      // core glow
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
      core.addColorStop(0, "rgba(255,106,43,.16)"); core.addColorStop(0.5, "rgba(255,106,43,.04)"); core.addColorStop(1, "rgba(255,106,43,0)");
      ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
      // embers
      for (const e of embers) {
        e.y -= e.v; e.w += 0.02;
        if (e.y < -0.05) { e.y = 1.05; e.x = Math.random(); }
        const x = e.x * w + Math.sin(e.w) * 12, y = e.y * h;
        ctx.fillStyle = `rgba(255,${120 + Math.floor(e.s * 40)},60,${0.25 + 0.5 * (1 - e.y)})`;
        ctx.beginPath(); ctx.arc(x, y, e.s, 0, Math.PI * 2); ctx.fill();
      }
    }
    function loop(now = performance.now()) {
      raf = 0;
      if (!canvas.isConnected) { window.removeEventListener("pointermove", onMove); io.disconnect(); return; }
      frame(now);
      if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && visible && !raf && canvas.isConnected) loop(); });
    loop();
  }

  // ── sparkline ──
  function sparkline(canvas, values, { color = "#ff6a2b", fill = true } = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { w, h, d } = fitCanvas(canvas);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!values || values.length < 2) {
      ctx.strokeStyle = "rgba(239,232,220,.15)"; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const X = (i) => (i / (values.length - 1)) * w, Y = (v) => h - 3 - ((v - min) / span) * (h - 6);
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
    if (fill) {
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, color + "40"); g.addColorStop(1, color + "00");
      ctx.fillStyle = g; ctx.fill();
    }
  }

  // ── full price chart with crosshair ──
  function priceChart(host, points, fmt) {
    host.innerHTML = '<canvas></canvas><div class="chart__tip"></div>';
    const canvas = host.querySelector("canvas"), tip = host.querySelector(".chart__tip");
    const ctx = canvas.getContext("2d");
    let hover = -1, progress = reduce ? 1 : 0;
    const up = points.length > 1 && points[points.length - 1].v >= points[0].v;
    const color = up ? "#5fd49a" : "#ff5d5d";
    function draw() {
      const { w, h, d } = fitCanvas(canvas);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const padL = 8, padR = 72, padT = 16, padB = 28;
      if (points.length < 2) {
        ctx.fillStyle = "rgba(239,232,220,.4)"; ctx.font = "13px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("No trades yet — the first buy draws the chart.", w / 2, h / 2);
        return;
      }
      const vals = points.map((p) => p.v);
      let min = Math.min(...vals), max = Math.max(...vals);
      const padV = (max - min) * 0.12 || max * 0.05 || 1;
      min -= padV; max += padV;
      const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1, ts = t1 - t0 || 1;
      const X = (t) => padL + ((t - t0) / ts) * (w - padL - padR), Y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
      // grid
      ctx.strokeStyle = "rgba(239,232,220,.06)"; ctx.fillStyle = "rgba(239,232,220,.4)"; ctx.font = "11px 'JetBrains Mono', monospace"; ctx.textAlign = "left";
      for (let i = 0; i <= 4; i++) {
        const v = min + ((max - min) * i) / 4, y = Y(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR + 6, y); ctx.stroke();
        ctx.fillText(fmt.axis(v), w - padR + 10, y + 4);
      }
      ctx.textAlign = "center";
      for (let i = 0; i <= 3; i++) {
        const t = t0 + (ts * i) / 3;
        ctx.fillText(fmt.time(t), Math.min(Math.max(X(t), 30), w - padR - 30), h - 8);
      }
      // line, stepped in time to reflect discrete trades
      const n = Math.max(2, Math.ceil(points.length * progress));
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (i === 0) ctx.moveTo(X(p.t), Y(p.v));
        else { ctx.lineTo(X(p.t), Y(points[i - 1].v)); ctx.lineTo(X(p.t), Y(p.v)); }
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
      const last = points[n - 1];
      ctx.lineTo(X(last.t), h - padB); ctx.lineTo(X(points[0].t), h - padB); ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, h - padB);
      g.addColorStop(0, color + "38"); g.addColorStop(1, color + "00");
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // last price marker
      const ly = Y(last.v);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(last.t), ly, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([2, 3]); ctx.strokeStyle = color + "99"; ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(w - padR + 6, ly); ctx.stroke(); ctx.setLineDash([]);
      // hover
      if (hover >= 0) {
        const p = points[hover], x = X(p.t), y = Y(p.v);
        ctx.strokeStyle = "rgba(239,232,220,.3)";
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
        ctx.fillStyle = "#efe8dc"; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        tip.innerHTML = `${fmt.value(p.v)}<br><span style="opacity:.6">${fmt.full(p.t)}</span>`;
        tip.style.opacity = 1;
        const tw = tip.offsetWidth;
        tip.style.left = Math.min(Math.max(x - tw / 2, 0), w - tw) + "px";
        tip.style.top = Math.max(y - 58, 0) + "px";
      } else tip.style.opacity = 0;
      draw.X = X; draw.w = w;
    }
    function animate() {
      if (progress >= 1) return draw();
      progress = Math.min(1, progress + 0.04);
      draw();
      requestAnimationFrame(animate);
    }
    canvas.addEventListener("pointermove", (e) => {
      if (points.length < 2 || !draw.X) return;
      const x = e.offsetX;
      let best = 0, bd = Infinity;
      points.forEach((p, i) => { const dd = Math.abs(draw.X(p.t) - x); if (dd < bd) { bd = dd; best = i; } });
      hover = best; draw();
    });
    canvas.addEventListener("pointerleave", () => { hover = -1; draw(); });
    const ro = new ResizeObserver(() => draw());
    ro.observe(host);
    animate();
  }

  // ── reveal on scroll + split words ──
  let io;
  function reveals(root = document) {
    root.querySelectorAll("[data-split]:not(.split)").forEach((el) => {
      const walk = (node) => {
        [...node.childNodes].forEach((n) => {
          if (n.nodeType === 3) {
            const frag = document.createDocumentFragment();
            n.textContent.split(/(\s+)/).forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
              const w = document.createElement("span"); w.className = "w";
              const s = document.createElement("span"); s.textContent = part; w.appendChild(s); frag.appendChild(w);
            });
            n.replaceWith(frag);
          } else if (n.nodeType === 1 && n.tagName !== "BR") walk(n);
        });
      };
      walk(el);
      el.querySelectorAll(".w > span").forEach((s, i) => s.style.setProperty("--i", i));
      el.classList.add("split");
      if (!el.classList.contains("reveal")) el.classList.add("reveal-split");
    });
    if (!io) {
      io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    }
    root.querySelectorAll(".reveal:not(.is-in), .split:not(.is-in)").forEach((el) => io.observe(el));
  }

  // ── pointer glow on buttons / sectors, and tilt on cards ──
  function pointerFx() {
    const spot = document.getElementById("spotlight");
    if (spot && !reduce) document.addEventListener("pointermove", (e) => { spot.style.setProperty("--sx", e.clientX + "px"); spot.style.setProperty("--sy", e.clientY + "px"); }, { passive: true });
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".btn, .sector");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });
    if (reduce || !window.matchMedia("(hover: hover)").matches) return;
    document.addEventListener("pointermove", (e) => {
      const card = e.target.closest && e.target.closest("[data-tilt]");
      document.querySelectorAll("[data-tilt].is-tilting").forEach((c) => { if (c !== card) { c.style.transform = ""; c.classList.remove("is-tilting"); } });
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add("is-tilting");
      card.style.transform = `perspective(1000px) rotateY(${px * 5}deg) rotateX(${-py * 5}deg)`;
    }, { passive: true });
  }

  // ── count-up for numbers ──
  function countUp(el, to, format, dur = 1400) {
    if (reduce || !isFinite(to)) { el.textContent = format(to); return; }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = format(to * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── deterministic gradient avatar from an address ──
  function avatarStyle(seed) {
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const a = h % 360, b = (a + 40 + (h >> 8) % 80) % 360;
    return `background: radial-gradient(circle at 30% 25%, hsl(${a} 90% 62%), transparent 60%), linear-gradient(135deg, hsl(${b} 70% 35%), hsl(${(a + 200) % 360} 50% 14%));`;
  }

  window.TF_FX = { heroLattice, sparkline, priceChart, reveals, pointerFx, countUp, avatarStyle, fitCanvas, reduce };
})();
