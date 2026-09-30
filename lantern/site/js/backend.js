// One interface over the demo network and a live chain deployment.
(function () {
  const { ethers } = window;
  const CFG = window.LN_CONFIG;
  const ABI = {
    ex: [
      "function markets() view returns (tuple(string symbol,uint16 maxLeverage,bool enabled,uint256 longNotional,uint256 shortNotional)[])",
      "function positionsOf(address) view returns (uint256[] ids, tuple(address trader,uint32 marketId,bool isLong,uint64 openedAt,uint256 margin,uint256 size,uint256 entryPrice)[] list)",
      "function positionValue(uint256) view returns (int256 pnl, int256 equity, bool liquidatable)",
      "function liquidationPrice(uint256) view returns (uint256)",
      "function vaultAssets() view returns (uint256)",
      "function totalMargin() view returns (uint256)",
      "function totalSupply() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function netExposure() view returns (uint256)",
      "function feeBps() view returns (uint256)",
      "function maintenanceBps() view returns (uint256)",
      "function liquidationRewardBps() view returns (uint256)",
      "function maxNetExposureBps() view returns (uint256)",
      "function minMargin() view returns (uint256)",
      "function open(uint256,bool,uint256,uint256) returns (uint256)",
      "function close(uint256) returns (uint256)",
      "function addMargin(uint256,uint256)",
      "function deposit(uint256) returns (uint256)",
      "function withdraw(uint256) returns (uint256)",
      "event Closed(uint256 indexed id, address indexed trader, uint256 indexed marketId, uint256 price, int256 pnl, uint256 payout, uint256 fee)",
      "event Liquidated(uint256 indexed id, address indexed trader, address indexed liquidator, uint256 price, uint256 reward)",
      "error BadMarket()", "error MarketDisabled()", "error BadLeverage()", "error MarginTooSmall()", "error ExposureCap()",
      "error NotOwnerOfPosition()", "error NoPosition()", "error NotLiquidatable()", "error ZeroAmount()", "error VaultInUse()",
      "error Stale(uint256 marketId, uint256 updatedAt)",
      "error ERC20InsufficientBalance(address,uint256,uint256)", "error ERC20InsufficientAllowance(address,uint256,uint256)",
    ],
    oracle: [
      "function latest(uint256) view returns (uint256 price, uint256 updatedAt)",
      "event PriceUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp)",
    ],
    erc20: [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function mint(address,uint256)",
    ],
  };
  const FRIENDLY = {
    BadMarket: "That market doesn't exist.",
    MarketDisabled: "This market is paused for new positions.",
    BadLeverage: "Leverage is outside the allowed range.",
    MarginTooSmall: "Margin is below the minimum.",
    ExposureCap: "The vault can't take more exposure on this side right now. Try a smaller size.",
    NotOwnerOfPosition: "Only the position's owner can do that.",
    NoPosition: "That position is already closed.",
    ZeroAmount: "Enter an amount.",
    VaultInUse: "That withdrawal would leave open positions uncovered. Try a smaller amount.",
    Stale: "The price feed is stale, so trading is paused until the next update.",
    ERC20InsufficientBalance: "Insufficient USDG balance.",
    ERC20InsufficientAllowance: "USDG approval is missing. Try again.",
  };
  const exIface = new ethers.Interface(ABI.ex);
  function friendly(e) {
    if (!e) return "Something went wrong.";
    const code = e.code ?? e.info?.error?.code;
    if (code === "ACTION_REJECTED" || code === 4001) return "You rejected the request in your wallet.";
    const data = e.data || e.info?.error?.data || e.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      try { const p = exIface.parseError(data); if (p && FRIENDLY[p.name]) return FRIENDLY[p.name]; } catch { /* unknown */ }
    }
    if (e.revert?.name && FRIENDLY[e.revert.name]) return FRIENDLY[e.revert.name];
    if (code === "INSUFFICIENT_FUNDS") return "Not enough native gas token for this transaction.";
    const msg = e.shortMessage || e.reason || e.message || String(e);
    return msg.length > 180 ? msg.slice(0, 180) + "…" : msg;
  }

  // ───────────────────────── demo ─────────────────────────
  function demo() {
    const d = new window.LN_DEMO.Demo();
    const listeners = new Set();
    let timer = null;
    const loop = () => {
      const liq = d.tick();
      listeners.forEach((f) => f({ liquidated: liq }));
    };
    return {
      demo: true, ready: true, name: CFG.demo.name, decimals: 6, symbol: "USDG", canFaucet: true,
      get account() { return d.account; },
      async connect() { return d.connect(); },
      disconnect() { d.disconnect(); },
      reset() { d.reset(); },
      async params() { return window.LN_DEMO.params; },
      async markets() {
        return CFG.markets.map((m, i) => ({ id: i, ...m, maxLeverage: 10, enabled: true, price: d.price(i), updatedAt: d.s.prices[i][d.s.prices[i].length - 1].t, longNotional: d.s.oi[i].long, shortNotional: d.s.oi[i].short }));
      },
      async history(i) { return d.s.prices[i].map((x) => ({ t: x.t, p: x.p / 1e8 })); },
      async balance() { return d.account ? d.s.balance : null; },
      async positions() { return d.account ? d.s.positions.map((p) => d.view(p)) : []; },
      async closed() { return d.account ? d.s.closed : []; },
      async vault() { return { assets: d.s.vault.assets, supply: d.s.vault.supply, mine: d.account ? d.s.vault.mine : null, net: d.netExposure(), totalMargin: d.s.totalMargin }; },
      async open(m, l, margin, lev, st) { st("Opening position…"); return d.open(m, l, margin, lev); },
      async close(id, st) { st("Closing position…"); return d.close(id); },
      async addMargin(id, a, st) { st("Adding margin…"); return d.addMargin(id, a); },
      async deposit(a, st) { st("Depositing…"); return d.deposit(a); },
      async withdraw(s, st) { st("Withdrawing…"); return d.withdraw(s); },
      async faucet() { return d.faucet(); },
      subscribe(f) { listeners.add(f); if (!timer) timer = setInterval(loop, 3000); return () => { listeners.delete(f); if (!listeners.size) { clearInterval(timer); timer = null; } }; },
      explorerTx: () => null,
    };
  }

  // ───────────────────────── chain ─────────────────────────
  function chain(chainId, dep) {
    const read = new ethers.JsonRpcProvider(dep.rpc, chainId, { staticNetwork: true });
    const exR = new ethers.Contract(dep.exchange, ABI.ex, read);
    const orR = new ethers.Contract(dep.oracle, ABI.oracle, read);
    const tokR = new ethers.Contract(dep.collateral, ABI.erc20, read);
    let signer = null, account = null, decimals = null;
    const listeners = new Set();
    let timer = null;
    const hex = "0x" + chainId.toString(16);

    // uses whichever real wallet the user picked (EIP-6963), switching it to this chain if needed
    async function ensure() {
      const W = window.LN_WALLET;
      if (!W.state) throw new Error("Connect a wallet first.");
      if (W.state.chainId !== chainId) {
        await W.switchChain(chainId, { chainName: dep.name, rpcUrls: [dep.rpc], nativeCurrency: dep.native || { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: dep.explorer ? [dep.explorer] : [] });
      }
      signer = await new ethers.BrowserProvider(W.provider, "any").getSigner();
      account = await signer.getAddress();
      return account;
    }
    const exW = () => new ethers.Contract(dep.exchange, ABI.ex, signer);
    async function dec() { if (decimals === null) decimals = Number(await tokR.decimals()); return decimals; }
    async function approve(amount, st) {
      const t = new ethers.Contract(dep.collateral, ABI.erc20, signer);
      if ((await t.allowance(account, dep.exchange)) >= amount) return;
      st("Approve USDG in your wallet…");
      await (await t.approve(dep.exchange, amount)).wait();
    }
    async function send(fn, st) {
      await ensure();
      st("Confirm in your wallet…");
      const tx = await fn();
      st("Waiting for confirmation…");
      return tx.wait();
    }

    return {
      demo: false, ready: true, name: dep.name, symbol: "USDG", get decimals() { return decimals ?? 6; }, canFaucet: chainId === 31337,
      get account() { return window.LN_WALLET.state?.account || null; },
      async connect() { await dec(); return ensure(); },
      disconnect() { signer = null; account = null; },
      reset() { signer = null; account = null; },
      async params() {
        const [feeBps, maintenanceBps, maxNetExposureBps, minMargin, rewardBps] = await Promise.all([exR.feeBps(), exR.maintenanceBps(), exR.maxNetExposureBps(), exR.minMargin(), exR.liquidationRewardBps()]);
        await dec();
        return { feeBps, maintenanceBps, maxNetExposureBps, minMargin, rewardBps };
      },
      async markets() {
        await dec();
        const ms = await exR.markets();
        const px = await Promise.all(ms.map((_, i) => orR.latest(i)));
        return ms.map((m, i) => {
          const meta = CFG.markets.find((x) => x.symbol === m.symbol) || { name: m.symbol, sector: "", hue: 30 };
          return { id: i, ...meta, symbol: m.symbol, maxLeverage: Number(m.maxLeverage), enabled: m.enabled, price: px[i][0], updatedAt: Number(px[i][1]), longNotional: m.longNotional, shortNotional: m.shortNotional };
        });
      },
      async history(i) {
        const latest = await read.getBlockNumber();
        const floor = Math.max(dep.startBlock || 0, latest - 40000);
        const evs = [];
        for (let to = latest; to >= floor; to -= 5000) {
          evs.unshift(...(await orR.queryFilter(orR.filters.PriceUpdated(i), Math.max(floor, to - 4999), to)));
        }
        return evs.map((e) => ({ t: Number(e.args.timestamp), p: Number(e.args.price) / 1e8 }));
      },
      async balance() { const a = window.LN_WALLET.state?.account; return a ? tokR.balanceOf(a) : null; },
      async positions() {
        const account = window.LN_WALLET.state?.account;
        if (!account) return [];
        const [ids, list] = await exR.positionsOf(account);
        const px = new Map();
        return Promise.all(list.map(async (p, k) => {
          const id = Number(ids[k]);
          let pnl = 0n, equity = p.margin, liquidatable = false, liqPrice = 0n;
          try { [pnl, equity, liquidatable] = await exR.positionValue(id); } catch { /* stale price */ }
          try { liqPrice = await exR.liquidationPrice(id); } catch { /* ignore */ }
          const mid = Number(p.marketId);
          if (!px.has(mid)) px.set(mid, (await orR.latest(mid))[0]);
          return { id, marketId: mid, isLong: p.isLong, openedAt: Number(p.openedAt), margin: p.margin, size: p.size, entryPrice: p.entryPrice, pnl, equity, liquidatable, liqPrice, mark: px.get(mid) };
        }));
      },
      async closed() {
        const account = window.LN_WALLET.state?.account;
        if (!account) return [];
        const latest = await read.getBlockNumber();
        const from = Math.max(dep.startBlock || 0, latest - 40000);
        const [c, l] = await Promise.all([exR.queryFilter(exR.filters.Closed(null, account), from, latest), exR.queryFilter(exR.filters.Liquidated(null, account), from, latest)]);
        const rows = [
          ...c.map((e) => ({ id: Number(e.args.id), marketId: Number(e.args.marketId), exit: e.args.price, pnl: e.args.pnl, payout: e.args.payout, block: e.blockNumber, tx: e.transactionHash })),
          ...l.map((e) => ({ id: Number(e.args.id), marketId: null, exit: e.args.price, pnl: null, payout: 0n, liquidated: true, block: e.blockNumber, tx: e.transactionHash })),
        ].sort((a, b) => b.block - a.block);
        return rows;
      },
      async vault() {
        const account = window.LN_WALLET.state?.account;
        const [assets, supply, net, totalMargin, mine] = await Promise.all([exR.vaultAssets(), exR.totalSupply(), exR.netExposure(), exR.totalMargin(), account ? exR.balanceOf(account) : null]);
        return { assets, supply, net, totalMargin, mine };
      },
      async open(m, isLong, margin, lev, st) { await ensure(); await approve(margin, st); return send(() => exW().open(m, isLong, margin, lev), st); },
      async close(id, st) { return send(() => exW().close(id), st); },
      async addMargin(id, a, st) { await ensure(); await approve(a, st); return send(() => exW().addMargin(id, a), st); },
      async deposit(a, st) { await ensure(); await approve(a, st); return send(() => exW().deposit(a), st); },
      async withdraw(s, st) { return send(() => exW().withdraw(s), st); },
      async faucet() { await ensure(); const t = new ethers.Contract(dep.collateral, ABI.erc20, signer); await (await t.mint(account, ethers.parseUnits("5000", await dec()))).wait(); },
      subscribe(f) { listeners.add(f); if (!timer) timer = setInterval(() => listeners.forEach((g) => g({})), 8000); return () => { listeners.delete(f); if (!listeners.size) { clearInterval(timer); timer = null; } }; },
      explorerTx: (h) => (dep.explorer ? `${dep.explorer}/tx/${h}` : null),
    };
  }

  // Preview: market data from the simulator; the wallet is real; nothing can be traded yet.
  function preview() {
    const d = demo();
    const closedMsg = "Trading opens when Lantern's contracts go live. Your wallet is connected, but no funds can move yet.";
    const no = async () => { throw new Error(closedMsg); };
    return {
      ...d, preview: true, demo: false, tradingOpen: false, canFaucet: false, name: "Preview",
      get account() { return window.LN_WALLET.state?.account || null; },
      async connect() { return window.LN_WALLET.state?.account || null; },
      disconnect() {}, reset() {},
      async balance() { return null; },
      async positions() { return []; },
      async closed() { return []; },
      async vault() { const v = await d.vault(); return { ...v, mine: null }; },
      open: no, close: no, addMargin: no, deposit: no, withdraw: no, faucet: no,
      closedMsg,
    };
  }

  function networks() {
    const deps = window.LN_DEPLOYMENTS || {};
    const list = Object.entries(deps).map(([id, d]) => ({ key: `chain-${id}`, chainId: Number(id), name: d.name, dep: d }));
    list.push({ key: "preview", name: "Preview", preview: true });
    return list;
  }

  window.LN_BACKEND = { make: (n) => (n.preview ? preview() : chain(n.chainId, n.dep)), networks, friendly };
})();
