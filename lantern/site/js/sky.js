// Lantern — full-page backdrop: a real photograph of overcast mountains
// ("Overcast Mountains" by Aleks Dahlberg, CC0) with live weather drawn on top.
// The weather follows the market: falling prices bring rain and a darker valley,
// rising ones let light through; liquidations flash lightning.
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    // photo layer (a fixed element, since background-attachment: fixed is unreliable on phones)
    const photo = document.createElement("div");
    photo.className = "backdrop";
    photo.setAttribute("aria-hidden", "true");
    photo.innerHTML = `<div class="backdrop__img"></div>`;
    document.body.prepend(photo);
    const img = photo.firstElementChild;
    // load the full photo after first paint; the tiny inline placeholder shows until then
    const full = new Image();
    full.src = innerWidth > 1100 ? "img/overcast-1920.jpg" : "img/overcast-1080.jpg";
    full.onload = () => { img.style.backgroundImage = `url("${full.src}")`; photo.classList.add("is-loaded"); };

    // weather layer
    const canvas = document.createElement("canvas");
    canvas.className = "sky";
    canvas.setAttribute("aria-hidden", "true");
    photo.after(canvas);
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, D = 1, drops = [], mist = [], mood = 0, moodTarget = 0, flash = 0, bolt = null, raf = 0, last = performance.now();

    function build() {
      D = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * D); canvas.height = Math.round(H * D);
      drops = Array.from({ length: Math.round(W / 5) }, () => ({ x: Math.random() * W, y: Math.random() * H, l: 10 + Math.random() * 18, v: 700 + Math.random() * 500, a: 0.25 + Math.random() * 0.5 }));
      // drifting fog banks for depth
      mist = Array.from({ length: 6 }, (_, i) => ({ x: Math.random() * W, y: H * (0.25 + i * 0.1), r: W * (0.25 + Math.random() * 0.2), v: 6 + Math.random() * 10 }));
      draw(0);
    }

    function makeBolt() {
      const pts = [[W * (0.2 + Math.random() * 0.6), 0]];
      while (pts[pts.length - 1][1] < H * 0.45) { const [x, y] = pts[pts.length - 1]; pts.push([x + (Math.random() - 0.5) * 60, y + 20 + Math.random() * 40]); }
      return pts;
    }

    function draw(dt) {
      ctx.setTransform(D, 0, 0, D, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // rolling fog
      for (const m of mist) {
        m.x += m.v * dt; if (m.x - m.r > W) m.x = -m.r;
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        const a = 0.05 + Math.max(0, -mood) * 0.05;
        g.addColorStop(0, `rgba(200,208,220,${a})`); g.addColorStop(1, "rgba(200,208,220,0)");
        ctx.fillStyle = g; ctx.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      }
      // light breaking through when markets rise
      if (mood > 0.05) {
        ctx.save(); ctx.globalCompositeOperation = "screen";
        const sx = W * 0.62, sy = -H * 0.05;
        for (let k = 0; k < 6; k++) {
          const a = 0.05 * mood, x0 = sx + (k - 3) * 40;
          const ray = ctx.createLinearGradient(x0, sy, x0 - 120 + k * 50, H * 0.9);
          ray.addColorStop(0, `rgba(255,236,200,${a})`); ray.addColorStop(1, "rgba(255,236,200,0)");
          ctx.fillStyle = ray; ctx.beginPath(); ctx.moveTo(x0 - 8, sy); ctx.lineTo(x0 + 8, sy); ctx.lineTo(x0 - 40 + k * 60, H); ctx.lineTo(x0 - 160 + k * 60, H); ctx.fill();
        }
        ctx.restore();
      }
      // rain when markets fall
      const rain = Math.max(0, -mood);
      if (rain > 0.05 && !reduce) {
        ctx.lineWidth = 1;
        const n = Math.floor(drops.length * Math.min(1, rain * 1.3));
        for (let i = 0; i < n; i++) {
          const d = drops[i]; d.y += d.v * dt; d.x -= d.v * dt * 0.15;
          if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 120); }
          ctx.strokeStyle = `rgba(210,220,235,${d.a * (0.35 + rain * 0.4)})`;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.15, d.y + d.l); ctx.stroke();
        }
      }
      // lightning
      if (flash > 0) {
        ctx.fillStyle = `rgba(230,236,255,${flash * 0.3})`; ctx.fillRect(0, 0, W, H);
        if (bolt && flash > 0.5) { ctx.strokeStyle = `rgba(245,248,255,${flash})`; ctx.lineWidth = 2; ctx.beginPath(); bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
        flash = Math.max(0, flash - dt * 2.2);
      }
    }

    function applyMood() {
      // darker, bluer valley in a falling market; a touch brighter and warmer in a rising one
      const b = 0.86 + mood * 0.14, s = 0.95 + mood * 0.12;
      photo.style.setProperty("--photo-filter", `brightness(${b.toFixed(3)}) saturate(${s.toFixed(3)}) contrast(1.05)`);
    }

    function loop(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const prev = mood;
      mood += (moodTarget - mood) * Math.min(1, dt * 0.8);
      if (Math.abs(mood - prev) > 0.0005) applyMood();
      draw(dt);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(loop);
    }
    // gentle parallax on scroll
    addEventListener("scroll", () => { photo.style.setProperty("--scroll", `${Math.min(scrollY, 2000) * -0.04}px`); }, { passive: true });
    let rt;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 150); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf && !reduce) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    build(); applyMood();
    if (!reduce) raf = requestAnimationFrame(loop);

    return {
      // average 24h change in % → mood in [-1, 1]
      setMood(avgPct) { moodTarget = Math.max(-1, Math.min(1, (isFinite(avgPct) ? avgPct : 0) / 3)); if (reduce) { mood = moodTarget; applyMood(); draw(0); } },
      lightning() { if (!reduce) { flash = 1; bolt = makeBolt(); } },
      get mood() { return moodTarget; },
    };
  }

  window.LN_SKY = { init };
})();
