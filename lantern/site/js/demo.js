// In-browser demo network. Mirrors LanternExchange's integer math (6-decimal collateral,
// 8-decimal prices) with a simulated price feed. Nothing here touches real funds.
(function () {
  const KEY = "ln-demo-v1";
  const BPS = 10000n, FEE = 10n, MAINT = 500n, REWARD = 50n, MAXNET = 5000n;
  const MIN_MARGIN = 5_000_000n; // 5 USDG
  const U = (n) => BigInt(Math.round(n * 1e6));
  const P = (n) => BigInt(Math.round(n * 1e8));
  const STEP = 300; // history resolution: 5 minutes
  const CFG = window.LN_CONFIG;

  const store = {
    load() { try { return localStorage.getItem(KEY); } catch { return null; } },
    save(v) { try { localStorage.setItem(KEY, v); } catch { /* session only */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
  const ser = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v));
  const de = (s) => JSON.parse(s, (k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));

  function rng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

  function seedState() {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 86400;
    const prices = CFG.markets.map((m, i) => {
      const r = rng(1000 + i);
      const drift = (r() - 0.5) * 0.0006;
      let p = m.seed * (1 - drift * 288 / 2);
      const pts = [];
      for (let t = start - (start % STEP); t <= now; t += STEP) {
        p = Math.max(0.5, p * (1 + drift + gauss(r) * 0.0028));
        pts.push({ t, p: Math.round(p * 1e8) });
      }
      return pts;
    });
    return {
      v: 1, prices, connected: false, balance: U(CFG.demo.startBalance), positions: [], closed: [], nextId: 1,
      vault: { assets: U(CFG.demo.vault), supply: U(CFG.demo.vault), mine: 0n }, totalMargin: 0n,
      oi: CFG.markets.map(() => ({ long: 0n, short: 0n })),
    };
  }

  class Demo {
    constructor() {
      let s = null;
      try { const raw = store.load(); s = raw ? de(raw) : null; } catch { s = null; }
      this.s = s && s.v === 1 ? s : seedState();
      this.r = rng(Date.now() & 0xffffffff);
      this.catchUp();
      this.save();
    }
    save() { store.save(ser(this.s)); }
    reset() { store.clear(); this.s = seedState(); this.save(); }
    get account() { return this.s.connected ? "0xde30000000000000000000000000000000001a17" : null; }
    connect() { this.s.connected = true; this.save(); return this.account; }
    disconnect() { this.s.connected = false; this.save(); }
    need() { if (!this.s.connected) throw new Error("Connect the demo wallet first."); }
    price(i) { const a = this.s.prices[i]; return BigInt(a[a.length - 1].p); }

    // advance the simulated feed to "now", filling gaps at 5-minute resolution
    catchUp() {
      const now = Math.floor(Date.now() / 1000);
      this.s.prices.forEach((pts) => {
        let last = pts[pts.length - 1];
        if (now - last.t > 86400) { pts.length = 0; pts.push({ t: now - 86400, p: last.p }); last = pts[0]; }
        while (now - last.t >= STEP) { last = { t: last.t + STEP, p: Math.max(5e7, Math.round(last.p * (1 + gauss(this.r) * 0.0028))) }; pts.push(last); }
        while (pts.length > 1 && pts[0].t < now - 86400) pts.shift();
      });
    }
    // one live tick: small move stamped "now"
    tick() {
      const now = Math.floor(Date.now() / 1000);
      this.catchUp();
      this.s.prices.forEach((pts) => {
        const last = pts[pts.length - 1];
        const p = Math.max(5e7, Math.round(last.p * (1 + gauss(this.r) * 0.0011)));
        if (now - last.t < STEP && pts.length > 1 && pts[pts.length - 2].t > now - STEP) last.p = p; // keep a rolling "live" point
        else pts.push({ t: now, p });
        last.t = Math.max(last.t, now);
      });
      const liquidated = this.sweep();
      this.save();
      return liquidated;
    }

    pnl(p, price) { const raw = (p.size * (price - p.entryPrice)) / p.entryPrice; return p.isLong ? raw : -raw; }
    liqPrice(p) { const e = p.entryPrice; const k = (((p.size * MAINT) / BPS - p.margin) * e) / p.size; const v = p.isLong ? e + k : e - k; return v > 0n ? v : 0n; }
    netExposure() { return this.s.oi.reduce((a, o) => a + (o.long > o.short ? o.long - o.short : o.short - o.long), 0n); }
    view(p) {
      const price = this.price(p.marketId);
      const pnl = this.pnl(p, price);
      const equity = p.margin + pnl;
      return { ...p, pnl, equity, liquidatable: equity < (p.size * MAINT) / BPS, liqPrice: this.liqPrice(p), mark: price };
    }
    settle(p, payout) {
      const o = this.s.oi[p.marketId];
      if (p.isLong) o.long -= p.size; else o.short -= p.size;
      this.s.totalMargin -= p.margin;
      if (payout >= p.margin) { let profit = payout - p.margin; if (profit > this.s.vault.assets) { profit = this.s.vault.assets; payout = p.margin + profit; } this.s.vault.assets -= profit; }
      else this.s.vault.assets += p.margin - payout;
      this.s.positions = this.s.positions.filter((x) => x.id !== p.id);
      return payout;
    }
    sweep() {
      const out = [];
      for (const p of [...this.s.positions]) {
        const v = this.view(p);
        if (!v.liquidatable) continue;
        const left = v.equity > 0n ? v.equity : 0n;
        let reward = (p.size * REWARD) / BPS; if (reward > left) reward = left;
        this.settle(p, reward);
        this.s.closed.unshift({ ...p, exit: v.mark, pnl: -p.margin, payout: 0n, closedAt: Math.floor(Date.now() / 1000), liquidated: true });
        out.push(p);
      }
      return out;
    }

    wait() { return new Promise((r) => setTimeout(r, 500 + Math.random() * 400)); }
    async open(marketId, isLong, margin, lev) {
      this.need();
      if (lev < 1 || lev > 10) throw new Error("Leverage must be between 1× and 10×.");
      if (margin < MIN_MARGIN) throw new Error("Minimum margin is 5 USDG.");
      if (margin > this.s.balance) throw new Error("Insufficient USDG balance.");
      const L = BigInt(lev);
      const fee = (margin * L * FEE) / BPS, net = margin - fee, size = net * L;
      const o = this.s.oi[marketId];
      if (isLong) o.long += size; else o.short += size;
      if (this.netExposure() * BPS > this.s.vault.assets * MAXNET) { if (isLong) o.long -= size; else o.short -= size; throw new Error("The vault can't take more exposure on this side right now. Try a smaller size."); }
      if (isLong) o.long -= size; else o.short -= size;
      await this.wait();
      if (isLong) o.long += size; else o.short += size;
      this.s.balance -= margin; this.s.vault.assets += fee; this.s.totalMargin += net;
      const p = { id: this.s.nextId++, marketId, isLong, openedAt: Math.floor(Date.now() / 1000), margin: net, size, entryPrice: this.price(marketId) };
      this.s.positions.push(p);
      this.save();
      return p.id;
    }
    async close(id) {
      this.need();
      const p = this.s.positions.find((x) => x.id === id);
      if (!p) throw new Error("Position not found.");
      await this.wait();
      const price = this.price(p.marketId);
      const pnl = this.pnl(p, price), fee = (p.size * FEE) / BPS, eq = p.margin + pnl - fee;
      const payout = this.settle(p, eq > 0n ? eq : 0n);
      this.s.balance += payout;
      this.s.closed.unshift({ ...p, exit: price, pnl, payout, fee, closedAt: Math.floor(Date.now() / 1000) });
      this.s.closed = this.s.closed.slice(0, 50);
      this.save();
      return payout;
    }
    async addMargin(id, amt) {
      this.need();
      const p = this.s.positions.find((x) => x.id === id);
      if (!p) throw new Error("Position not found.");
      if (amt <= 0n || amt > this.s.balance) throw new Error("Insufficient USDG balance.");
      await this.wait();
      p.margin += amt; this.s.balance -= amt; this.s.totalMargin += amt;
      this.save();
    }
    async deposit(amt) {
      this.need();
      if (amt <= 0n || amt > this.s.balance) throw new Error("Insufficient USDG balance.");
      await this.wait();
      const v = this.s.vault;
      const shares = v.supply === 0n || v.assets === 0n ? amt : (amt * v.supply) / v.assets;
      v.assets += amt; v.supply += shares; v.mine += shares; this.s.balance -= amt;
      this.save();
    }
    async withdraw(shares) {
      this.need();
      const v = this.s.vault;
      if (shares <= 0n || shares > v.mine) throw new Error("You don't have that many vault shares.");
      const assets = (shares * v.assets) / v.supply;
      if (this.netExposure() * BPS > (v.assets - assets) * MAXNET) throw new Error("That withdrawal would leave open positions uncovered. Try a smaller amount.");
      await this.wait();
      v.assets -= assets; v.supply -= shares; v.mine -= shares; this.s.balance += assets;
      this.save();
      return assets;
    }
    async faucet() { this.need(); await this.wait(); this.s.balance += U(5000); this.save(); }
  }

  window.LN_DEMO = { Demo, params: { feeBps: FEE, maintenanceBps: MAINT, maxNetExposureBps: MAXNET, minMargin: MIN_MARGIN, rewardBps: REWARD } };
})();
