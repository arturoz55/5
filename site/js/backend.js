// One interface, two implementations: a live EVM chain (ethers v6) or the in-browser demo network.
(function () {
  const { ethers } = window;
  const ABI = window.TF_ABI;
  const ZERO = ethers.ZeroAddress;
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  function parseMeta(s) {
    try {
      const m = JSON.parse(s || "{}");
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    } catch { return {}; }
  }

  function normalize(v, id) {
    return {
      id: id === undefined ? null : Number(id),
      token: v.token, pool: v.pool, quote: v.quote, creator: v.creator,
      createdAt: Number(v.createdAt), name: String(v.name), symbol: String(v.symbol),
      meta: parseMeta(v.metadata), metadata: String(v.metadata),
      totalSupply: BigInt(v.totalSupply), reserveToken: BigInt(v.reserveToken), reserveQuote: BigInt(v.reserveQuote),
    };
  }

  // ───────────────────────────── demo ─────────────────────────────
  function demoBackend(net) {
    const chain = new window.TF_DEMO.DemoChain();
    const labelOf = (q) => (q === ZERO ? "TAO" : "wSN10");
    return {
      net, demo: true, ready: true,
      get account() { return chain.account; },
      async connect() { return chain.connect(); },
      disconnect() { chain.disconnect(); },
      reset() { chain.reset(); },
      async quoteAssets() {
        return [{ asset: ZERO, label: "TAO", symbol: "TAO", min: ethers.parseEther("0.1") },
          ...chain.quoteAssets().map((a) => ({ asset: a.asset, label: a.label, symbol: "wSN10", min: a.min }))];
      },
      quoteSymbol: async (q) => labelOf(q),
      async list() { return chain.launches().map((l) => normalize(l, l.id)).reverse(); },
      async get(token) {
        const l = chain.find(token);
        if (!l) throw new Error("This token was not launched on the demo network.");
        return normalize(l, l.id);
      },
      async swaps(l) { return chain.swaps(l).map((s) => ({ ...s })); },
      async quoteBuy(l, q) { return chain.quoteBuy(l, q); },
      async quoteSell(l, t) { return chain.quoteSell(l, t); },
      async balances(l) {
        if (!chain.account) return null;
        return { quote: chain.bal(l.quote), token: chain.bal(l.token) };
      },
      async nativeBalance() { return chain.account ? chain.bal(ZERO) : null; },
      async assetBalance(a) { return chain.account ? chain.bal(a) : null; },
      async create(p, status) { status("Forging your market…"); return chain.create(p); },
      async buy(l, q, min, status) { status("Submitting buy…"); return chain.buy(l, q, min); },
      async sell(l, t, min, status) { status("Submitting sell…"); return chain.sell(l, t, min); },
      explorerTx: () => null, explorerAddr: () => null,
    };
  }

  // ───────────────────────────── chain ─────────────────────────────
  function chainBackend(net) {
    const dep = (window.TF_DEPLOYMENTS || {})[String(net.chainId)];
    const read = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
    const factoryAddr = dep && dep.factory;
    const factoryR = factoryAddr ? new ethers.Contract(factoryAddr, ABI.factory, read) : null;
    let account = null;
    let signer = null;
    const symCache = new Map([[ZERO, "TAO"]]);
    const hex = "0x" + net.chainId.toString(16);

    async function ensureWallet() {
      if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask, Rabby or Talisman to continue.");
      const bp = new ethers.BrowserProvider(window.ethereum, "any");
      const accounts = await bp.send("eth_requestAccounts", []);
      if (!accounts.length) throw new Error("Wallet returned no accounts");
      const current = Number((await bp.getNetwork()).chainId);
      if (current !== net.chainId) {
        try {
          await bp.send("wallet_switchEthereumChain", [{ chainId: hex }]);
        } catch (e) {
          const code = e?.error?.code ?? e?.info?.error?.code ?? e?.code;
          if (code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || "")) {
            await bp.send("wallet_addEthereumChain", [{
              chainId: hex, chainName: net.name, rpcUrls: [net.rpc],
              nativeCurrency: net.native, blockExplorerUrls: net.explorer ? [net.explorer] : [],
            }]);
          } else throw e;
        }
      }
      const fresh = new ethers.BrowserProvider(window.ethereum, "any");
      signer = await fresh.getSigner();
      account = await signer.getAddress();
      return account;
    }

    function need() {
      if (!factoryR) throw new Error(`Tensorforge is not deployed on ${net.name} yet.`);
    }

    async function approveIfNeeded(tokenAddr, spender, amount, status, label) {
      const t = new ethers.Contract(tokenAddr, ABI.erc20, signer);
      const allowance = await t.allowance(account, spender);
      if (allowance >= amount) return;
      status(`Approve ${label} in your wallet…`);
      const tx = await t.approve(spender, amount);
      status(`Waiting for ${label} approval…`);
      await tx.wait();
    }

    return {
      net, demo: false, ready: !!factoryR, factory: factoryAddr, startBlock: dep ? dep.startBlock : 0,
      get account() { return account; },
      async connect() { return ensureWallet(); },
      disconnect() { account = null; signer = null; },
      async quoteAssets() {
        need();
        const [assets, minNative] = await Promise.all([factoryR.quoteAssets(), factoryR.minNativeLiquidity()]);
        const out = [{ asset: ZERO, label: "TAO", symbol: "TAO", min: minNative }];
        for (const a of assets) {
          if (!a.allowed) continue;
          const [symbol, min] = await Promise.all([this.quoteSymbol(a.asset), factoryR.minQuoteLiquidity(a.asset)]);
          out.push({ asset: a.asset, label: a.label, symbol, min });
        }
        return out;
      },
      async quoteSymbol(q) {
        if (symCache.has(q)) return symCache.get(q);
        let s = "ALPHA";
        try { s = await new ethers.Contract(q, ABI.erc20, read).symbol(); } catch { /* keep fallback */ }
        symCache.set(q, s);
        return s;
      },
      async list() {
        need();
        const count = Number(await factoryR.launchCount());
        const out = [];
        for (let off = 0; off < count; off += 50) {
          const page = await factoryR.getLaunches(off, 50);
          page.forEach((v, i) => out.push(normalize(v, count - 1 - off - i)));
        }
        return out;
      },
      async get(token) {
        need();
        if (!ethers.isAddress(token)) throw new Error("That is not a valid address.");
        try {
          const [id, v] = await factoryR.getLaunchByToken(token);
          return normalize(v, id);
        } catch (e) {
          if (/unknown token/.test(e?.reason || e?.shortMessage || e?.message || "")) throw new Error(`This token was not launched by Tensorforge on ${net.name}.`);
          throw e;
        }
      },
      async swaps(l) {
        const pool = new ethers.Contract(l.pool, ABI.pool, read);
        const latest = await read.getBlockNumber();
        const step = 5000;
        const floor = Math.max(this.startBlock || 0, latest - step * 40);
        const events = [];
        for (let to = latest; to >= floor; to -= step) {
          const from = Math.max(floor, to - step + 1);
          const chunk = await pool.queryFilter(pool.filters.Swap(), from, to);
          events.unshift(...chunk);
          if (chunk.length === 0 && from <= floor) break;
          // stop once we've scanned past the pool's creation
          const b = await read.getBlock(from);
          if (b && b.timestamp < l.createdAt) break;
        }
        const tsCache = new Map();
        const rows = [];
        for (const ev of events) {
          let ts = tsCache.get(ev.blockNumber);
          if (ts === undefined) { ts = (await read.getBlock(ev.blockNumber)).timestamp; tsCache.set(ev.blockNumber, ts); }
          const a = ev.args;
          rows.push({ ts, isBuy: a.isBuy, quoteAmount: a.quoteAmount, tokenAmount: a.tokenAmount, reserveQuote: a.reserveQuote, reserveToken: a.reserveToken, trader: a.trader, tx: ev.transactionHash });
        }
        return rows;
      },
      async quoteBuy(l, q) { return new ethers.Contract(l.pool, ABI.pool, read).quoteBuy(q); },
      async quoteSell(l, t) { return new ethers.Contract(l.pool, ABI.pool, read).quoteSell(t); },
      async balances(l) {
        if (!account) return null;
        const tok = new ethers.Contract(l.token, ABI.erc20, read);
        const quote = l.quote === ZERO ? read.getBalance(account) : new ethers.Contract(l.quote, ABI.erc20, read).balanceOf(account);
        const [q, t] = await Promise.all([quote, tok.balanceOf(account)]);
        return { quote: q, token: t };
      },
      async nativeBalance() { return account ? read.getBalance(account) : null; },
      async assetBalance(a) {
        if (!account) return null;
        return a === ZERO ? read.getBalance(account) : new ethers.Contract(a, ABI.erc20, read).balanceOf(account);
      },
      async create(p, status) {
        need();
        if (!signer) await ensureWallet();
        const factory = new ethers.Contract(factoryAddr, ABI.factory, signer);
        const fee = await factoryR.launchFee();
        let value = fee;
        if (p.quote === ZERO) value += p.quoteAmount;
        else await approveIfNeeded(p.quote, factoryAddr, p.quoteAmount, status, "reserve asset");
        status("Confirm the launch in your wallet…");
        const tx = await factory.createLaunch(p, { value });
        status("Forging your market on-chain…");
        const rc = await tx.wait();
        for (const log of rc.logs) {
          try {
            const ev = factory.interface.parseLog(log);
            if (ev && ev.name === "LaunchCreated") return ev.args.token;
          } catch { /* not ours */ }
        }
        throw new Error("Launch confirmed but the event could not be read. Check the markets list.");
      },
      async buy(l, q, min, status) {
        if (!signer) await ensureWallet();
        const pool = new ethers.Contract(l.pool, ABI.pool, signer);
        let tx;
        if (l.quote === ZERO) {
          status("Confirm the buy in your wallet…");
          tx = await pool.buy(min, account, deadline(), { value: q });
        } else {
          await approveIfNeeded(l.quote, l.pool, q, status, "reserve asset");
          status("Confirm the buy in your wallet…");
          tx = await pool.buyWithQuote(q, min, account, deadline());
        }
        status("Waiting for confirmation…");
        return tx.wait();
      },
      async sell(l, t, min, status) {
        if (!signer) await ensureWallet();
        await approveIfNeeded(l.token, l.pool, t, status, l.symbol);
        const pool = new ethers.Contract(l.pool, ABI.pool, signer);
        status("Confirm the sell in your wallet…");
        const tx = await pool.sell(t, min, account, deadline());
        status("Waiting for confirmation…");
        return tx.wait();
      },
      explorerTx: (h) => (net.explorer ? `${net.explorer}/tx/${h}` : null),
      explorerAddr: (a) => (net.explorer ? `${net.explorer}/address/${a}` : null),
    };
  }

  const errIface = new ethers.Interface([
    "error Slippage(uint256 out, uint256 minOut)", "error Expired()", "error ZeroAmount()", "error WrongAsset()",
    "error InsufficientLiquidity()", "error BadName()", "error BadSupply()", "error MetadataTooLong()",
    "error QuoteNotAllowed()", "error BadValue(uint256 expected, uint256 got)", "error LiquidityTooLow(uint256 min)",
    "error NotInitialized()", "error TransferFailed()", "error ERC20InsufficientBalance(address,uint256,uint256)",
  ]);
  const FRIENDLY = {
    Slippage: "Price moved beyond your slippage tolerance. Try again or raise slippage.",
    Expired: "The transaction expired before it was mined.",
    ZeroAmount: "Amount is too small to trade.",
    WrongAsset: "This pool trades against a different reserve asset.",
    InsufficientLiquidity: "Not enough liquidity for that trade.",
    BadName: "Name must be 1–48 bytes and symbol 1–12 bytes.",
    BadSupply: "Supply must be between 1 and 10^15 tokens.",
    MetadataTooLong: "Description and links are too long.",
    QuoteNotAllowed: "That reserve asset is not supported.",
    BadValue: "Sent value didn't match liquidity plus launch fee.",
    LiquidityTooLow: "Initial liquidity is below the minimum.",
    ERC20InsufficientBalance: "Insufficient token balance.",
  };

  function friendlyError(e) {
    if (!e) return "Something went wrong";
    const code = e.code ?? e.info?.error?.code;
    if (code === "ACTION_REJECTED" || code === 4001) return "You rejected the request in your wallet.";
    const data = e.data || e.info?.error?.data || e.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      try { const p = errIface.parseError(data); if (p && FRIENDLY[p.name]) return FRIENDLY[p.name]; } catch { /* unknown */ }
    }
    if (e.revert?.name && FRIENDLY[e.revert.name]) return FRIENDLY[e.revert.name];
    if (code === "INSUFFICIENT_FUNDS") return "Insufficient TAO to cover this transaction and gas.";
    const msg = e.shortMessage || e.reason || e.message || String(e);
    return msg.length > 180 ? msg.slice(0, 180) + "…" : msg;
  }

  window.TF_BACKEND = {
    make: (net) => (net.demo ? demoBackend(net) : chainBackend(net)),
    friendlyError,
    ZERO,
  };
})();
