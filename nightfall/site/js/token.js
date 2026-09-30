// Nightfall — the $NIGHTFALL community token: live banner, home section, footer address,
// copy / explorer / add-to-wallet actions. The token is live; the trading desk opens at launch.
(function () {
  const T = window.LN_CONFIG.token;
  if (!T) return;
  const $ = (s, r = document) => r.querySelector(s);
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const tokenUrl = `${T.explorer}/token/${T.address}`;
  const nf = new Intl.NumberFormat("en-US");
  let toast = () => {};

  async function copy() {
    try { await navigator.clipboard.writeText(T.address); toast("ok", "Contract address copied", short(T.address)); }
    catch { toast("err", "Couldn't copy", T.address); }
  }

  // switch the wallet to Robinhood Chain (adding it if needed), then ask it to track the token
  async function addToWallet(connect) {
    const W = window.LN_WALLET;
    try {
      if (!W.state) { await connect(); if (!W.state) return; }
      if (W.state.chainId !== T.chainId) {
        await W.switchChain(T.chainId, { chainName: T.chainName, rpcUrls: [T.rpc], blockExplorerUrls: [T.explorer], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } });
      }
      const added = await W.provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: T.address, symbol: T.symbol, decimals: T.decimals } } });
      if (added === false) toast("err", "Not added", "The wallet declined the request.");
      else toast("ok", `$${T.symbol} added`, `Tracking on ${T.chainName}`);
    } catch (e) {
      console.warn(e);
      toast("err", "Couldn't add the token", e?.code === 4001 ? "Request rejected in the wallet." : "Add it manually with the contract address.");
    }
  }

  const caChip = (id) => `<button class="ca" ${id ? `id="${id}"` : ""} data-copy-ca title="Copy contract address" aria-label="Copy contract address ${T.address}"><span class="ca__full mono">${T.address}</span><span class="ca__short mono">${short(T.address)}</span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>`;

  function bind(root) { root.querySelectorAll("[data-copy-ca]").forEach((b) => (b.onclick = copy)); }

  function banner() {
    const el = $("#live");
    if (!el) return;
    el.className = "livebar";
    el.innerHTML = `<span class="livebar__dot" aria-hidden="true"></span><b>$${T.symbol} is live</b><span class="hide-sm"> on ${T.chainName}</span><span class="livebar__sep" aria-hidden="true">·</span>${caChip("liveCa")}<a class="livebar__link hide-sm" href="${tokenUrl}" target="_blank" rel="noopener">Explorer ↗</a>`;
    bind(el);
  }

  function footer() {
    const el = $("#footerCa");
    if (!el) return;
    el.innerHTML = `<span class="label">$${T.symbol} · ${T.chainName}</span>${caChip()}<a class="small" href="${tokenUrl}" target="_blank" rel="noopener">View on explorer ↗</a>`;
    bind(el);
  }

  // home page section
  function section(el, connect) {
    el.innerHTML = `<div class="token panel">
      <div class="token__copy">
        <span class="kicker">Live now</span>
        <h2 class="h2" style="margin-top:14px">$${T.symbol} is live on ${T.chainName}.</h2>
        <p class="lead" style="margin-top:12px">The Nightfall community token. The night desk for China's giants. Always check the contract address before you buy.</p>
        <div class="token__ca"><span class="label">Contract address (CA)</span>${caChip("tokenCa")}</div>
        <div class="row" style="margin-top:18px"><button class="btn btn--amber" id="tokenAdd">Add to wallet</button><a class="btn btn--ghost" href="${tokenUrl}" target="_blank" rel="noopener">View on explorer ↗</a></div>
      </div>
      <dl class="token__facts">
        <div><dt class="label">Token</dt><dd>${T.name} ($${T.symbol})</dd></div>
        <div><dt class="label">Network</dt><dd>${T.chainName} · ID ${T.chainId}</dd></div>
        <div><dt class="label">Total supply</dt><dd class="mono">${nf.format(T.supply)}</dd></div>
        <div><dt class="label">Decimals</dt><dd class="mono">${T.decimals}</dd></div>
        <div><dt class="label">Trading desk</dt><dd>Opens at launch</dd></div>
      </dl>
    </div>`;
    bind(el);
    $("#tokenAdd", el).onclick = () => addToWallet(connect);
  }

  function init(opts) {
    toast = opts.toast || toast;
    banner();
    footer();
  }

  window.LN_TOKEN = { config: T, url: tokenUrl, init, section, copy, addToWallet };
})();
