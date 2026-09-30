// In-browser demo network. It mirrors ForgeFactory / ForgePool math exactly (same integer
// arithmetic, same fees) so the whole product can be tried without a wallet or real funds.
(function () {
  const KEY = "tf-demo-v1";
  const FEE_BPS = 100n, PROTOCOL_FEE_BPS = 50n, BPS = 10000n;
  const E18 = 10n ** 18n;
  const ZERO = "0x0000000000000000000000000000000000000000";
  const ALPHA = "0xa1fa0000000000000000000000000000000000a0";
  const ACCOUNT = "0xde5f000000000000000000000000000000c0ffee";

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function addr(r) {
    let s = "0x";
    for (let i = 0; i < 40; i++) s += Math.floor(r() * 16).toString(16);
    return s;
  }
  const ether = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

  const store = {
    load() { try { return localStorage.getItem(KEY); } catch { return null; } },
    save(v) { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable: session-only */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  const BIG_FIELDS = ["totalSupply", "reserveToken", "reserveQuote", "quoteAmount", "tokenAmount", "amount"];
  function serialize(state) {
    return JSON.stringify(state, (k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v));
  }
  function deserialize(s) {
    return JSON.parse(s, (k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));
  }

  function quoteBuy(l, qIn) {
    const net = qIn - (qIn * FEE_BPS) / BPS;
    return (net * l.reserveToken) / (l.reserveQuote + net);
  }
  function quoteSell(l, tIn) {
    const gross = (tIn * l.reserveQuote) / (l.reserveToken + tIn);
    return gross - (gross * FEE_BPS) / BPS;
  }
  function applyBuy(l, qIn) {
    const out = quoteBuy(l, qIn);
    if (out <= 0n) throw new Error("Amount too small");
    if (out >= l.reserveToken) throw new Error("Insufficient liquidity");
    l.reserveToken -= out;
    l.reserveQuote += qIn - (qIn * PROTOCOL_FEE_BPS) / BPS;
    return out;
  }
  function applySell(l, tIn) {
    const gross = (tIn * l.reserveQuote) / (l.reserveToken + tIn);
    const out = gross - (gross * FEE_BPS) / BPS;
    if (out <= 0n) throw new Error("Amount too small");
    l.reserveToken += tIn;
    l.reserveQuote -= out + (gross * PROTOCOL_FEE_BPS) / BPS;
    return out;
  }

  const SEED = [
    { name: "Lattice Agents", symbol: "LATT", sector: "agents", kind: "Subnet Coin", netuid: 1, liq: 40, vol: 1.4, days: 9, desc: "A community coin for people convinced autonomous agents become Bittensor's biggest workload." },
    { name: "Coldwire", symbol: "WIRE", sector: "inference", kind: "Token", liq: 12, vol: 1.1, days: 6, desc: "Conviction in cheap, fast, open inference for everyone." },
    { name: "Proof of Shard", symbol: "SHARD", sector: "data", kind: "Subnet Candidate", liq: 5, vol: 0.8, days: 4, desc: "Candidate subnet for verifiable dataset curation. Building in the open, weekly updates." },
    { name: "Gridlock", symbol: "GRID", sector: "compute", kind: "Token", liq: 60, vol: 0.9, days: 12, alpha: true, desc: "Compute-market conviction, paired with SN10 alpha." },
    { name: "Hollow Weights", symbol: "HLLW", sector: "training", kind: "Subnet Candidate", liq: 3, vol: 1.6, days: 2, desc: "Exploring sparse distributed pre-training. Candidate thesis and roadmap inside." },
    { name: "Tidal", symbol: "TIDE", sector: "trading", kind: "Token", liq: 20, vol: 1.2, days: 7, desc: "Signals, not noise. A community around prediction subnets." },
    { name: "Kiln", symbol: "KILN", sector: "agents", kind: "Subnet Coin", netuid: 22, liq: 15, vol: 1.3, days: 1, desc: "Backing agentic search. Community-run, independent of the subnet team." },
  ];

  function seedState() {
    const r = rng(964);
    const now = Math.floor(Date.now() / 1000);
    const s = {
      v: 1,
      launches: [],
      swaps: {},
      balances: { [ACCOUNT.toLowerCase()]: { [ZERO]: ether(250), [ALPHA]: ether(500) } },
      quoteAssets: [{ asset: ALPHA, label: "SN10 · alpha (demo wrapper)", allowed: true, min: ether(1) }],
      connected: false,
    };
    SEED.forEach((d, i) => {
      const created = now - Math.floor(d.days * 86400 + r() * 3600);
      const l = {
        id: i, token: addr(r), pool: addr(r), quote: d.alpha ? ALPHA : ZERO, creator: addr(r), createdAt: created,
        name: d.name, symbol: d.symbol,
        metadata: JSON.stringify({ description: d.desc, sector: d.sector, kind: d.kind, netuid: d.netuid || null, website: "", x: "" }),
        totalSupply: 1_000_000_000n * E18, reserveToken: 1_000_000_000n * E18, reserveQuote: ether(d.liq),
      };
      const hist = [];
      const n = 26 + Math.floor(r() * 30);
      let bias = 0.62;
      for (let j = 0; j < n; j++) {
        const ts = created + Math.floor(((j + 1) / (n + 1)) * (now - created));
        const trader = addr(r);
        bias += (r() - 0.5) * 0.1;
        const buy = r() < Math.min(0.85, Math.max(0.35, bias));
        const pre = { ...l };
        if (buy || l.reserveToken > l.totalSupply - E18) {
          const q = ether(Math.max(0.05, r() * d.liq * 0.12 * d.vol));
          const out = applyBuy(l, q);
          hist.push({ ts, isBuy: true, quoteAmount: q, tokenAmount: out, reserveQuote: l.reserveQuote, reserveToken: l.reserveToken, trader, tx: addr(r) + addr(r).slice(2, 26) });
        } else {
          const circulating = l.totalSupply - l.reserveToken;
          const t = (circulating * BigInt(Math.floor(r() * 250 + 20))) / 1000n;
          if (t <= 0n) { Object.assign(l, pre); continue; }
          const out = applySell(l, t);
          hist.push({ ts, isBuy: false, quoteAmount: out, tokenAmount: t, reserveQuote: l.reserveQuote, reserveToken: l.reserveToken, trader, tx: addr(r) + addr(r).slice(2, 26) });
        }
      }
      s.launches.push(l);
      s.swaps[l.pool] = hist;
    });
    return s;
  }

  class DemoChain {
    constructor() {
      const raw = store.load();
      try { this.s = raw ? deserialize(raw) : seedState(); } catch { this.s = seedState(); }
      if (!this.s || this.s.v !== 1) this.s = seedState();
      this.r = rng(Date.now() & 0xffffffff);
      this.save();
    }
    save() { store.save(serialize(this.s)); }
    reset() { store.clear(); this.s = seedState(); this.save(); }
    get account() { return this.s.connected ? ACCOUNT : null; }
    connect() { this.s.connected = true; this.save(); return ACCOUNT; }
    disconnect() { this.s.connected = false; this.save(); }
    wait() { return new Promise((res) => setTimeout(res, 550 + Math.random() * 500)); }
    bal(asset) {
      const b = this.s.balances[ACCOUNT.toLowerCase()];
      return b[asset.toLowerCase()] || 0n;
    }
    setBal(asset, v) {
      this.s.balances[ACCOUNT.toLowerCase()][asset.toLowerCase()] = v;
    }
    need(asset, amt, label) {
      if (this.bal(asset) < amt) throw new Error(`Insufficient ${label} balance`);
    }
    launches() { return this.s.launches; }
    find(token) { return this.s.launches.find((l) => l.token.toLowerCase() === String(token).toLowerCase()); }
    quoteAssets() { return this.s.quoteAssets; }
    quoteBuy(l, q) { return quoteBuy(this.find(l.token), q); }
    quoteSell(l, t) { return quoteSell(this.find(l.token), t); }
    swaps(l) { return this.s.swaps[l.pool] || []; }

    async create(p) {
      if (!this.account) throw new Error("Connect the demo wallet first");
      const nameLen = new TextEncoder().encode(p.name).length, symLen = new TextEncoder().encode(p.symbol).length;
      if (!nameLen || nameLen > 48 || !symLen || symLen > 12) throw new Error("Name must be 1–48 bytes and symbol 1–12 bytes");
      if (p.supply < E18 || p.supply > 10n ** 33n) throw new Error("Supply out of range");
      if (new TextEncoder().encode(p.metadata).length > 2048) throw new Error("Metadata too long");
      const isNative = p.quote === ZERO;
      const min = isNative ? ether(0.1) : (this.s.quoteAssets.find((a) => a.asset === p.quote) || {}).min;
      if (min === undefined) throw new Error("Reserve asset not allowed");
      if (p.quoteAmount < min || p.quoteAmount === 0n) throw new Error("Initial liquidity below the minimum");
      this.need(p.quote, p.quoteAmount, isNative ? "TAO" : "alpha");
      await this.wait();
      this.setBal(p.quote, this.bal(p.quote) - p.quoteAmount);
      const l = {
        id: this.s.launches.length, token: addr(this.r), pool: addr(this.r), quote: p.quote, creator: ACCOUNT,
        createdAt: Math.floor(Date.now() / 1000), name: p.name, symbol: p.symbol, metadata: p.metadata,
        totalSupply: p.supply, reserveToken: p.supply, reserveQuote: p.quoteAmount,
      };
      this.s.launches.push(l);
      this.s.swaps[l.pool] = [];
      this.save();
      return l.token;
    }
    async buy(view, qIn, minOut) {
      if (!this.account) throw new Error("Connect the demo wallet first");
      const l = this.find(view.token);
      if (qIn <= 0n) throw new Error("Enter an amount");
      this.need(l.quote, qIn, l.quote === ZERO ? "TAO" : "alpha");
      const q = quoteBuy(l, qIn);
      if (q < minOut) throw new Error("Price moved beyond your slippage tolerance");
      await this.wait();
      const out = applyBuy(l, qIn);
      this.setBal(l.quote, this.bal(l.quote) - qIn);
      this.setBal(l.token, this.bal(l.token) + out);
      this.s.swaps[l.pool].push({ ts: Math.floor(Date.now() / 1000), isBuy: true, quoteAmount: qIn, tokenAmount: out, reserveQuote: l.reserveQuote, reserveToken: l.reserveToken, trader: ACCOUNT, tx: addr(this.r) + addr(this.r).slice(2, 26) });
      this.save();
      return out;
    }
    async sell(view, tIn, minOut) {
      if (!this.account) throw new Error("Connect the demo wallet first");
      const l = this.find(view.token);
      if (tIn <= 0n) throw new Error("Enter an amount");
      this.need(l.token, tIn, l.symbol);
      const q = quoteSell(l, tIn);
      if (q < minOut) throw new Error("Price moved beyond your slippage tolerance");
      await this.wait();
      const out = applySell(l, tIn);
      this.setBal(l.token, this.bal(l.token) - tIn);
      this.setBal(l.quote, this.bal(l.quote) + out);
      this.s.swaps[l.pool].push({ ts: Math.floor(Date.now() / 1000), isBuy: false, quoteAmount: out, tokenAmount: tIn, reserveQuote: l.reserveQuote, reserveToken: l.reserveToken, trader: ACCOUNT, tx: addr(this.r) + addr(this.r).slice(2, 26) });
      this.save();
      return out;
    }
  }

  window.TF_DEMO = { DemoChain, ZERO, ALPHA, ACCOUNT, quoteBuy, quoteSell, serialize, deserialize };
})();
