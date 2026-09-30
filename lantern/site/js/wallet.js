// Lantern — real wallet connection for EVM wallets.
// Discovers every installed wallet through EIP-6963 (MetaMask, Phantom, Rabby, Coinbase Wallet,
// Brave, OKX, Trust…), falls back to a legacy window.ethereum, and never touches private keys:
// all it asks the wallet for is the account list, the chain id and a balance.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };

  const CHAINS = {
    1: "Ethereum", 10: "Optimism", 56: "BNB Chain", 137: "Polygon", 8453: "Base", 42161: "Arbitrum", 43114: "Avalanche",
    11155111: "Sepolia", 84532: "Base Sepolia", 31337: "Local node", 964: "Bittensor EVM",
  };
  // shown when nothing is installed
  const SUGGESTED = [
    { name: "MetaMask", rdns: "io.metamask", url: "https://metamask.io/download/" },
    { name: "Phantom", rdns: "app.phantom", url: "https://phantom.com/download" },
    { name: "Rabby", rdns: "io.rabby", url: "https://rabby.io/" },
    { name: "Coinbase Wallet", rdns: "com.coinbase.wallet", url: "https://www.coinbase.com/wallet/downloads" },
  ];
  const safeIcon = (s) => (typeof s === "string" && /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/i.test(s) ? s : "");

  const found = new Map(); // uuid -> { info, provider }
  const listeners = new Set();
  let current = null; // { info, provider, account, chainId }

  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = e.detail;
    if (!d || !d.info || !d.provider || !d.info.uuid) return;
    found.set(d.info.uuid, { info: d.info, provider: d.provider });
  });
  const discover = () => window.dispatchEvent(new Event("eip6963:requestProvider"));
  discover();

  function available() {
    const list = [...found.values()];
    // legacy fallback for wallets that only inject window.ethereum
    if (!list.length && window.ethereum) {
      const p = window.ethereum;
      const name = p.isPhantom ? "Phantom" : p.isRabby ? "Rabby" : p.isCoinbaseWallet ? "Coinbase Wallet" : p.isBraveWallet ? "Brave Wallet" : p.isMetaMask ? "MetaMask" : "Browser wallet";
      list.push({ info: { uuid: "legacy", name, icon: "", rdns: "legacy" }, provider: p });
    }
    return list;
  }

  const emit = () => listeners.forEach((f) => f(state()));
  const state = () => (current ? { account: current.account, chainId: current.chainId, chainName: CHAINS[current.chainId] || `Chain ${current.chainId}`, name: current.info.name, icon: safeIcon(current.info.icon), provider: current.provider } : null);

  function bind(w) {
    const p = w.provider;
    const onAcc = (accs) => { if (!current || current.provider !== p) return; if (!accs || !accs.length) { disconnect(); return; } current.account = accs[0]; emit(); };
    const onChain = (id) => { if (!current || current.provider !== p) return; current.chainId = Number(id); emit(); };
    const onDisc = () => { if (current && current.provider === p) disconnect(); };
    p.on?.("accountsChanged", onAcc); p.on?.("chainChanged", onChain); p.on?.("disconnect", onDisc);
    w.unbind = () => { p.removeListener?.("accountsChanged", onAcc); p.removeListener?.("chainChanged", onChain); p.removeListener?.("disconnect", onDisc); };
  }

  async function connectWith(w, silent) {
    const method = silent ? "eth_accounts" : "eth_requestAccounts";
    const accs = await w.provider.request({ method });
    if (!accs || !accs.length) { if (silent) return null; throw new Error("The wallet didn't share an account."); }
    const chainId = Number(await w.provider.request({ method: "eth_chainId" }));
    if (current && current.unbind) current.unbind();
    current = { ...w, account: accs[0], chainId };
    bind(current);
    ls.set("ln-wallet", w.info.rdns || w.info.name);
    emit();
    return state();
  }

  function disconnect() {
    if (current && current.unbind) current.unbind();
    // wallets keep the site authorised until the user revokes it; permission revocation is best effort
    current?.provider.request?.({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    current = null;
    ls.set("ln-wallet", null);
    emit();
  }

  // reconnect quietly on page load if the user connected before (no popup)
  async function restore() {
    const want = ls.get("ln-wallet");
    if (!want) return;
    await new Promise((r) => setTimeout(r, 300)); // let wallets announce
    const w = available().find((x) => (x.info.rdns || x.info.name) === want);
    if (w) { try { await connectWith(w, true); } catch { /* stay disconnected */ } }
  }

  async function balance() {
    if (!current) return null;
    const hex = await current.provider.request({ method: "eth_getBalance", params: [current.account, "latest"] });
    return BigInt(hex);
  }

  async function switchChain(chainId, add) {
    if (!current) throw new Error("Connect a wallet first.");
    const hex = "0x" + chainId.toString(16);
    try { await current.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch (e) {
      const code = e?.code ?? e?.data?.originalError?.code;
      if ((code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || "")) && add) await current.provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, ...add }] });
      else throw e;
    }
  }

  // ───────────── picker ─────────────
  function picker(toast) {
    return new Promise((resolve) => {
      discover();
      const box = document.createElement("div");
      box.className = "cmdk wallet-picker";
      const close = (v) => { box.remove(); removeEventListener("keydown", key); resolve(v); };
      const key = (e) => { if (e.key === "Escape") close(null); };
      addEventListener("keydown", key);
      const render = () => {
        const list = available();
        const installed = new Set(list.map((w) => w.info.rdns));
        const missing = SUGGESTED.filter((s) => !installed.has(s.rdns));
        box.innerHTML = `<div class="cmdk__box" role="dialog" aria-label="Connect a wallet">
          <div class="wp__head"><div><span class="label">Connect</span><h2 class="h3" style="margin:6px 0 0">Choose a wallet</h2></div><button class="iconbtn" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
          <ul class="wp__list">${list.length ? list.map((w, i) => `<li><button class="wp__item" data-i="${i}">${safeIcon(w.info.icon) ? `<img src="${esc(safeIcon(w.info.icon))}" alt="" width="32" height="32">` : `<span class="wp__ph">${esc(w.info.name[0] || "?")}</span>`}<span><b>${esc(w.info.name)}</b><small>Detected</small></span></button></li>`).join("") : `<li class="wp__none">No wallet found in this browser.</li>`}</ul>
          ${missing.length ? `<div class="wp__more"><span class="label">${list.length ? "Other wallets" : "Get a wallet"}</span><div class="row" style="gap:6px;margin-top:10px">${missing.map((s) => `<a class="chipbtn" href="${s.url}" target="_blank" rel="noopener">${s.name} ↗</a>`).join("")}</div></div>` : ""}
          <p class="faint small wp__note">Lantern only asks your wallet for your address and network. It never sees your seed phrase or private keys, and every transaction needs your approval in the wallet.</p>
        </div>`;
        box.querySelector("[data-close]").onclick = () => close(null);
        box.querySelectorAll("[data-i]").forEach((b) => (b.onclick = async () => {
          const w = list[Number(b.dataset.i)];
          b.disabled = true; b.querySelector("small").textContent = "Check your wallet…";
          try { const s = await connectWith(w, false); close(s); }
          catch (e) {
            b.disabled = false; b.querySelector("small").textContent = "Detected";
            const rejected = e?.code === 4001 || /reject|denied/i.test(e?.message || "");
            toast("err", rejected ? "Connection cancelled" : "Couldn't connect", rejected ? "You declined the request in your wallet." : (e?.message || "Try again."));
          }
        }));
      };
      box.addEventListener("click", (e) => { if (e.target === box) close(null); });
      document.body.appendChild(box);
      render();
      // late announcements (some wallets respond after a moment)
      setTimeout(() => box.isConnected && render(), 400);
    });
  }

  // small menu for a connected wallet
  function menu(anchor, { onDisconnect, explorer, toast }) {
    document.querySelector(".wallet-menu")?.remove();
    const s = state(); if (!s) return;
    const m = document.createElement("div");
    m.className = "wallet-menu";
    m.setAttribute("role", "menu");
    m.innerHTML = `<div class="wm__who">${s.icon ? `<img src="${esc(s.icon)}" alt="" width="28" height="28">` : ""}<div><b>${esc(s.name)}</b><div class="mono small faint">${esc(s.account.slice(0, 8))}…${esc(s.account.slice(-6))}</div></div></div>
      <div class="wm__row"><span class="faint small">Network</span><span class="mono small">${esc(s.chainName)}</span></div>
      <div class="wm__row"><span class="faint small">Balance</span><span class="mono small" id="wmBal">…</span></div>
      <button role="menuitem" data-a="copy">Copy address</button>
      ${explorer ? `<a role="menuitem" href="${esc(explorer(s.account))}" target="_blank" rel="noopener">View on explorer ↗</a>` : ""}
      <button role="menuitem" data-a="disc" class="short">Disconnect</button>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 8}px`; m.style.right = `${Math.max(12, innerWidth - r.right)}px`;
    balance().then((b) => { const el = m.querySelector("#wmBal"); if (el && b !== null) el.textContent = `${Number(b) / 1e18 < 0.0001 && b > 0n ? "<0.0001" : (Number(b) / 1e18).toFixed(4)} ${s.chainId === 964 ? "TAO" : s.chainId === 56 ? "BNB" : s.chainId === 137 ? "POL" : "ETH"}`; }).catch(() => { const el = m.querySelector("#wmBal"); if (el) el.textContent = "—"; });
    const off = (e) => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off); } };
    setTimeout(() => document.addEventListener("pointerdown", off), 0);
    m.querySelector('[data-a="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(s.account); toast("ok", "Address copied", ""); } catch { toast("err", "Couldn't copy", s.account); } m.remove(); };
    m.querySelector('[data-a="disc"]').onclick = () => { m.remove(); disconnect(); onDisconnect && onDisconnect(); };
  }

  window.LN_WALLET = {
    picker, menu, disconnect, restore, balance, switchChain, available,
    get state() { return state(); },
    get provider() { return current ? current.provider : null; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
})();
