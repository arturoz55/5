// Lantern — full-page backdrop: mountain ranges under a heavy, dim, overcast sky.
// Mountains are rendered once per resize to an offscreen canvas; clouds drift on top.
// The weather follows the market: falling prices bring rain, rising ones open gaps of light.
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  // smooth 1D value noise
  function noise1(seed) {
    const r = rng(seed), pts = Array.from({ length: 512 }, () => r());
    return (x) => { const i = Math.floor(x), f = x - i, a = pts[((i % 512) + 512) % 512], b = pts[(((i + 1) % 512) + 512) % 512], t = f * f * (3 - 2 * f); return a + (b - a) * t; };
  }
  const ridge = (n, x) => { let v = 0, amp = 1, fr = 1, norm = 0; for (let o = 0; o < 6; o++) { v += (1 - Math.abs(n(x * fr) * 2 - 1)) * amp; norm += amp; amp *= 0.5; fr *= 2.1; } return v / norm; };

  function mix(a, b, t) {
    const pa = parse(a), pb = parse(b);
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
  }
  function parse(c) {
    const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; const v = x.fillStyle;
    if (v.startsWith("#")) { const n = parseInt(v.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    return v.match(/\d+/g).slice(0, 3).map(Number);
  }

  function makeCloud(r, w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    const puffs = 26 + Math.floor(r() * 20);
    for (let i = 0; i < puffs; i++) {
      const x = w * (0.12 + r() * 0.76), y = h * (0.35 + r() * 0.4) - Math.sin((x / w) * Math.PI) * h * 0.18;
      const rad = h * (0.16 + r() * 0.26);
      const grd = g.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
      grd.addColorStop(0, "rgba(255,255,255,0.55)"); grd.addColorStop(0.55, "rgba(255,255,255,0.22)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    // darker underbelly
    g.globalCompositeOperation = "source-atop";
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(0.55, "rgba(0,0,0,0.35)"); shade.addColorStop(1, "rgba(0,0,0,0.7)");
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
    return c;
  }

  function init() {
    const canvas = document.createElement("canvas");
    canvas.className = "sky";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
    const ctx = canvas.getContext("2d");
    const land = document.createElement("canvas");
    let W = 0, H = 0, D = 1, clouds = [], drops = [], mood = 0, moodTarget = 0, flash = 0, raf = 0, last = performance.now();

    function tint(sprite, color) {
      const c = document.createElement("canvas"); c.width = sprite.width; c.height = sprite.height;
      const g = c.getContext("2d");
      g.drawImage(sprite, 0, 0);
      g.globalCompositeOperation = "source-in"; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-over"; g.globalAlpha = 0.9; g.drawImage(sprite, 0, 0);
      return c;
    }

    function build() {
      D = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * D); canvas.height = Math.round(H * D);
      land.width = canvas.width; land.height = canvas.height;
      const g = land.getContext("2d"); g.setTransform(D, 0, 0, D, 0, 0);
      const far = css("--mtn-far") || "#2c3645", near = css("--mtn-near") || "#0b0f17", haze = css("--sky-bottom") || "#3b4556";
      const layers = 5;
      for (let L = 0; L < layers; L++) {
        const t = L / (layers - 1);
        const n = noise1(97 + L * 13);
        const base = H * (0.5 + t * 0.2), amp = H * (0.26 - t * 0.12), scale = 0.0022 + t * 0.0016;
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W + 4; x += 4) {
          const y = base - ridge(n, x * scale + L * 40) * amp - Math.sin(x / W * Math.PI * (1 + L * 0.3) + L) * amp * 0.12;
          g.lineTo(x, y);
        }
        g.lineTo(W, H); g.closePath();
        const col = mix(mix(far, haze, 0.35 * (1 - t)), near, t);
        const grd = g.createLinearGradient(0, base - amp, 0, H);
        grd.addColorStop(0, col); grd.addColorStop(1, mix(col, near, 0.6));
        g.fillStyle = grd; g.fill();
        // valley mist between ranges
        if (L < layers - 1) {
          const mist = g.createLinearGradient(0, base - amp * 0.2, 0, base + H * 0.08);
          mist.addColorStop(0, "rgba(0,0,0,0)"); mist.addColorStop(1, mix(haze, far, 0.3).replace("rgb", "rgba").replace(")", ",0.45)"));
          g.fillStyle = mist; g.fillRect(0, base - amp * 0.2, W, H * 0.3);
        }
        // a few dark pines on the nearest ridges
        if (L >= layers - 2) {
          const r = rng(500 + L);
          g.fillStyle = mix(near, "#000", 0.25);
          for (let x = 0; x < W; x += 6 + r() * 16) {
            const y = base - ridge(n, x * scale + L * 40) * amp - Math.sin(x / W * Math.PI * (1 + L * 0.3) + L) * amp * 0.12;
            const th = 6 + r() * (10 + L * 4);
            g.beginPath(); g.moveTo(x, y - th); g.lineTo(x - th * 0.28, y + 2); g.lineTo(x + th * 0.28, y + 2); g.fill();
          }
        }
      }
      const r = rng(7);
      const cloudCol = css("--cloud") || "#1b212c", cloudLit = css("--cloud-lit") || "#56606f";
      clouds = Array.from({ length: Math.round(12 + W / 160) }, (_, i) => {
        const cw = 420 + r() * 520, ch = cw * (0.32 + r() * 0.12);
        const sprite = makeCloud(r, Math.round(cw), Math.round(ch));
        const depth = r();
        return { img: tint(sprite, mix(cloudLit, cloudCol, 0.35 + depth * 0.65)), x: r() * (W + cw) - cw, y: -ch * 0.35 + r() * H * 0.42, w: cw, h: ch, v: 4 + depth * 14, depth, a: 0.55 + depth * 0.45 };
      }).sort((a, b) => a.depth - b.depth);
      drops = Array.from({ length: 220 }, () => ({ x: r() * W, y: r() * H, l: 8 + r() * 16, v: 500 + r() * 400 }));
      draw(0);
    }

    function draw(dt) {
      const top = css("--sky-top") || "#161c27", bottom = css("--sky-bottom") || "#3b4556";
      ctx.setTransform(D, 0, 0, D, 0, 0);
      const sy = scrollY * 0.04;
      // sky: brighter when the market mood is up
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, mix(top, bottom, Math.max(0, mood) * 0.35)); g.addColorStop(0.7, bottom); g.addColorStop(1, bottom);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // weak sun behind the overcast
      const sx = W * 0.72, syy = H * 0.24;
      const sun = ctx.createRadialGradient(sx, syy, 0, sx, syy, H * 0.5);
      sun.addColorStop(0, `rgba(255,236,200,${0.1 + Math.max(0, mood) * 0.18})`); sun.addColorStop(1, "rgba(255,236,200,0)");
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
      // light shafts when the market is rising
      if (mood > 0.05) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        for (let k = 0; k < 5; k++) {
          const a = 0.04 * mood, x0 = sx - 120 + k * 60;
          const ray = ctx.createLinearGradient(x0, syy, x0 - 160 + k * 30, H);
          ray.addColorStop(0, `rgba(255,240,210,${a})`); ray.addColorStop(1, "rgba(255,240,210,0)");
          ctx.fillStyle = ray; ctx.beginPath(); ctx.moveTo(x0 - 10, syy); ctx.lineTo(x0 + 10, syy); ctx.lineTo(x0 - 60 + k * 50, H); ctx.lineTo(x0 - 200 + k * 50, H); ctx.fill();
        }
        ctx.restore();
      }
      // far clouds, mountains, near clouds (parallax on scroll)
      const drawClouds = (from, to) => {
        for (const c of clouds) {
          if (c.depth < from || c.depth >= to) continue;
          c.x += (c.v * (1 + Math.max(0, -mood) * 0.8)) * dt;
          if (c.x > W + 40) c.x = -c.w - 40;
          ctx.globalAlpha = Math.min(1, c.a * (1 + Math.max(0, -mood) * 0.3) * (1 - Math.max(0, mood) * 0.35));
          ctx.drawImage(c.img, c.x, c.y - sy * (0.5 + c.depth), c.w, c.h);
        }
        ctx.globalAlpha = 1;
      };
      drawClouds(0, 0.55);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(land, 0, -sy * 1.4 * D);
      ctx.setTransform(D, 0, 0, D, 0, 0);
      drawClouds(0.55, 1.01);
      // rain when the market is falling
      const rain = Math.max(0, -mood);
      if (rain > 0.05 && !reduce) {
        ctx.strokeStyle = `rgba(200,210,225,${0.12 + rain * 0.18})`; ctx.lineWidth = 1;
        ctx.beginPath();
        const n = Math.floor(drops.length * Math.min(1, rain * 1.4));
        for (let i = 0; i < n; i++) {
          const d = drops[i]; d.y += d.v * dt; d.x -= d.v * dt * 0.18;
          if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 100); }
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y + d.l);
        }
        ctx.stroke();
      }
      // lightning flash
      if (flash > 0) { ctx.fillStyle = `rgba(235,240,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2.5); }
      // readability veil
      const veil = ctx.createLinearGradient(0, 0, 0, H);
      veil.addColorStop(0, css("--veil-top") || "rgba(8,11,18,.35)"); veil.addColorStop(1, css("--veil-bottom") || "rgba(8,11,18,.55)");
      ctx.fillStyle = veil; ctx.fillRect(0, 0, W, H);
    }

    function loop(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      mood += (moodTarget - mood) * Math.min(1, dt * 0.8);
      draw(dt);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(loop);
    }
    let rt;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 150); });
    addEventListener("scroll", () => { if (reduce) draw(0); }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf && !reduce) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    document.addEventListener("ln:theme", () => build());
    build();
    if (!reduce) raf = requestAnimationFrame(loop);

    return {
      // avg 24h change in % → mood in [-1, 1]
      setMood(avgPct) { moodTarget = Math.max(-1, Math.min(1, (isFinite(avgPct) ? avgPct : 0) / 3)); if (reduce) { mood = moodTarget; draw(0); } },
      lightning() { if (!reduce) flash = 1; },
      get mood() { return moodTarget; },
    };
  }

  window.LN_SKY = { init };
})();
