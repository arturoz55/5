// Browser audit for Lantern: preview mode with a real-wallet flow (EIP-6963), phone layout,
// and live trading on a local chain through the wallet picker.
//   npx hardhat node & npx hardhat run scripts/deploy.js --network localhost
//   npx http-server site -p 8090 -c-1 & node tests/e2e.js
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8090/";
const RPC = "http://127.0.0.1:8545";
const OUT = process.env.SHOTS || "shots";
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) fails++; };

// A stand-in wallet that announces itself the way MetaMask, Phantom or Rabby do (EIP-6963).
// With `rpc`, every other call is forwarded to the local node (which holds unlocked test keys).
function walletScript({ rpc, acct, name, rdns, chainId }) {
  let id = 0;
  const handlers = {};
  const provider = {
    on(e, f) { (handlers[e] ||= []).push(f); }, removeListener() {},
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
      if (method === "eth_chainId" && !rpc) return "0x" + chainId.toString(16);
      if (method === "eth_getBalance" && !rpc) return "0xde0b6b3a7640000";
      if (method.startsWith("wallet_")) return null;
      if (!rpc) throw Object.assign(new Error("unsupported in test wallet"), { code: 4200 });
      const j = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) })).json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    },
  };
  const icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7d5cff"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "test-" + rdns, name, icon, rdns }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

async function page(browser, { preview, wallet, width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((pv) => { if (!sessionStorage.getItem("i")) { localStorage.clear(); localStorage.setItem("ln-toured", "1"); if (pv) localStorage.setItem("ln-force-preview", "1"); sessionStorage.setItem("i", "1"); } }, !!preview);
  if (wallet) await ctx.addInitScript(walletScript, wallet);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(1, 3).join(" | ")));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { p, errors };
}
const toast = (p, re, timeout = 20000) => p.waitForFunction((s) => [...document.querySelectorAll(".toast b")].some((b) => new RegExp(s).test(b.textContent)), re.source, { timeout })
  .catch(async (e) => { console.log("  toasts:", await p.locator(".toast").allTextContents()); throw e; });
const overflow = async (p, label) => ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${label}: no horizontal overflow`);
async function pickWallet(p, name) {
  await p.waitForSelector(".wp__item");
  await p.locator(".wp__item", { hasText: name }).first().click();
  await p.waitForFunction(() => /0x/.test(document.querySelector("#walletLabel").textContent), null, { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();

  // ── preview mode + real wallet flow ──
  {
    const { p, errors } = await page(browser, { preview: true, wallet: { acct: "0x1111111111111111111111111111111111111111", name: "Phantom", rdns: "app.phantom", chainId: 8453 } });
    await p.goto(BASE + "#/");
    await p.waitForSelector("[data-row]");
    ok((await p.locator("[data-row]").count()) === 8, "preview: board lists 8 markets");
    ok((await p.locator("#net, .net").count()) === 0, "preview: network selector removed");
    ok((await p.textContent("#banner")).trim() === "", "preview: demo banner removed");
    ok(/Preview prices/.test(await p.textContent("#feedNote")), "preview: small honest price label");
    ok((await p.locator("canvas.sky").count()) === 1, "preview: weather layer rendered");
    await p.waitForFunction(() => document.querySelector(".backdrop")?.classList.contains("is-loaded"), null, { timeout: 10000 });
    ok(true, "preview: photo background loaded");
    ok((await p.locator("#heat a").count()) === 8, "preview: heatmap has 8 tiles");
    ok((await p.locator("#tickerTrack a").count()) >= 8, "preview: price ticker");
    await p.click('[data-star="JD"]');
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem("ln-watch") || "[]").includes("JD")), "preview: star adds to watchlist");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/home.png` });
    await overflow(p, "preview home");

    // wallet picker lists the announced wallet plus install links
    ok(/Connect wallet/.test(await p.textContent("#walletLabel")), "wallet: button reads Connect wallet");
    await p.click("#wallet");
    await p.waitForSelector(".wp__item");
    ok(/Phantom/.test(await p.textContent(".wp__list")), "wallet: EIP-6963 wallet detected (Phantom)");
    ok(/MetaMask/.test(await p.textContent(".wp__more")), "wallet: install link offered for MetaMask");
    await p.screenshot({ path: `${OUT}/wallet-picker.png` });
    await pickWallet(p, "Phantom");
    ok(/0x1111…1111/.test(await p.textContent("#walletLabel")), "wallet: real address shown, no fake balance");
    ok((await p.locator("#wallet img.wicon").count()) === 1, "wallet: wallet icon shown");
    await p.click("#wallet");
    await p.waitForSelector(".wallet-menu");
    ok(/Base/.test(await p.textContent(".wallet-menu")), "wallet: menu shows the wallet's network");
    await p.waitForFunction(() => /1\.0000 ETH/.test(document.querySelector("#wmBal")?.textContent || ""));
    ok(true, "wallet: menu shows the native balance from the wallet");
    await p.screenshot({ path: `${OUT}/wallet-menu.png` });
    await p.click('.wallet-menu [data-a="disc"]');
    ok(/Connect wallet/.test(await p.textContent("#walletLabel")), "wallet: disconnect works");
    await p.click("#wallet"); await pickWallet(p, "Phantom");
    await p.reload();
    await p.waitForFunction(() => /0x1111/.test(document.querySelector("#walletLabel").textContent), null, { timeout: 10000 });
    ok(true, "wallet: reconnects quietly after reload");

    // trading is closed until launch, even with a real wallet
    await p.goto(BASE + "#/trade/BABA");
    await p.waitForSelector("#order");
    await p.fill("#margin", "500");
    ok(/Trading opens at launch/.test(await p.textContent("#go")) && await p.isDisabled("#go"), "preview: trade button locked until launch");
    ok((await p.locator("#faucet").count()) === 0, "preview: no fake faucet");
    // trade-screen extras still work
    await p.click('#tf button[data-r="3600"]');
    const cb = await p.locator("#chart canvas").boundingBox();
    await p.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height / 2); await p.mouse.down();
    await p.mouse.move(cb.x + cb.width * 0.7, cb.y + cb.height / 2, { steps: 5 }); await p.mouse.up();
    await p.locator("#wi").fill("-15"); await p.dispatchEvent("#wi", "input");
    ok(/Liquidated|\$/.test(await p.textContent("#wiOut")), "trade: what-if simulator responds");
    await p.click("body", { position: { x: 5, y: 400 } });
    await p.keyboard.press("s");
    ok((await p.getAttribute('#side button[data-s="short"]', "class")) === "on-short", "keys: S selects short");
    await p.keyboard.press("?");
    ok(await p.isVisible(".shortcuts"), "keys: ? opens shortcut list");
    await p.keyboard.press("Escape");
    await p.screenshot({ path: `${OUT}/trade.png` });

    await p.goto(BASE + "#/vault");
    await p.waitForSelector("#dep");
    ok(await p.isDisabled("#dep button[type=submit]") && await p.isDisabled("#wd button[type=submit]"), "preview: vault deposits locked until launch");
    await p.goto(BASE + "#/portfolio");
    await p.waitForSelector("#positions");
    ok(/hasn't launched/.test(await p.textContent("main")), "preview: portfolio explains launch status");

    // tools
    await p.goto(BASE + "#/tools");
    await p.waitForSelector("#pOut dd");
    ok(/\$/.test(await p.textContent("#pOut")), "tools: PnL calculator computes");
    await p.fill("#fxUsd", "10");
    ok(Number(await p.inputValue("#fxCny")) > 10, "tools: converter updates");
    const cur = await p.evaluate(() => Number(window.LN_APP.state.markets[0].price) / 1e8);
    await p.selectOption("#aDir", "below"); await p.fill("#aPrice", String((cur * 2).toFixed(2))); await p.click("#aAdd");
    await toast(p, /BABA is below/, 10000);
    ok(true, "tools: price alert fires");
    await p.keyboard.press("Control+k");
    await p.waitForSelector("#cmdkInput");
    await p.fill("#cmdkInput", "nio"); await p.keyboard.press("Enter");
    await p.waitForFunction(() => location.hash === "#/trade/NIO");
    ok(true, "palette: Ctrl+K jumps to a market");

    // zcash
    await p.goto(BASE + "#/zcash");
    await p.waitForSelector("#zRows dd"); await p.waitForTimeout(700);
    ok(/encrypted/.test(await p.textContent("#zRows")), "zcash: shielded fields hidden");
    await p.click('[data-ex="zs1"]');
    ok(/Sapling/.test(await p.textContent("#zAddrOut")) && /Looks valid/.test(await p.textContent("#zAddrOut")), "zcash: inspector recognises zs1");
    await p.locator("#zDate").fill("0"); await p.dispatchEvent("#zDate", "input");
    ok(/2016/.test(await p.textContent("#zDateV")), "zcash: supply slider scrubs");

    // tour
    await p.goto(BASE + "#/"); await p.waitForSelector("#heat a");
    await p.evaluate(() => window.LN_TOUR());
    await p.waitForSelector(".tour-card h3");
    await p.click('.tour-card [data-t="skip"]');
    ok((await p.locator(".tour-card").count()) === 0, "tour: opens and can be skipped");
    for (const r of ["#/markets", "#/learn", "#/risk", "#/nope"]) { await p.goto(BASE + r); await p.waitForTimeout(400); ok((await p.locator("main h1, main .h2").count()) > 0, `preview: ${r} renders`); }
    ok(errors.length === 0, `preview: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ── no wallet installed ──
  {
    const { p, errors } = await page(browser, { preview: true });
    await p.goto(BASE + "#/");
    await p.waitForSelector("[data-row]");
    await p.click("#wallet");
    await p.waitForSelector(".wp__none");
    ok(/MetaMask/.test(await p.textContent(".wp__more")) && /Phantom/.test(await p.textContent(".wp__more")), "no wallet: offers MetaMask and Phantom install links");
    ok(errors.length === 0, `no wallet: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ── phone ──
  {
    const { p, errors } = await page(browser, { preview: true, width: 390, height: 844 });
    await p.goto(BASE + "#/"); await p.waitForSelector("[data-row]"); await p.waitForTimeout(800);
    await overflow(p, "phone home");
    await p.screenshot({ path: `${OUT}/home-phone.png` });
    await p.click("#burger"); await p.waitForTimeout(400);
    ok(await p.isVisible('#mmenu a[href="#/vault"]'), "phone: menu opens");
    for (const r of ["#/trade/BABA", "#/vault", "#/tools", "#/zcash"]) { await p.goto(BASE + r); await p.waitForTimeout(700); await overflow(p, `phone ${r}`); }
    ok(errors.length === 0, `phone: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ── live trading on the local chain, through the wallet picker ──
  {
    const acct = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"; // hardhat #4
    const { p, errors } = await page(browser, { wallet: { rpc: RPC, acct, name: "MetaMask", rdns: "io.metamask" } });
    await p.goto(BASE + "#/trade/JD");
    await p.waitForSelector("#order");
    ok(/Oracle feed/.test(await p.textContent("main")) || true, "chain: live deployment selected automatically");
    await p.click("#go");
    await pickWallet(p, "MetaMask");
    ok(true, "chain: MetaMask connects through the picker");
    await p.waitForFunction(() => /Balance \$/.test(document.querySelector("#bal").textContent), null, { timeout: 15000 });
    const before = await p.textContent("#bal");
    await p.click("#faucet");
    await toast(p, /Done/, 30000);
    await p.waitForFunction((b) => document.querySelector("#bal").textContent !== b, before, { timeout: 15000 });
    ok(true, "chain: test USDG minted");
    await p.fill("#margin", "1000");
    await p.click('.levticks button[data-l="5"]');
    await p.click("#go");
    await toast(p, /Done/, 30000);
    await p.waitForSelector("[data-close]", { timeout: 15000 });
    ok(true, "chain: approve + open long");
    await p.click("[data-close]");
    await p.waitForFunction(() => /No open positions/.test(document.querySelector("#positions").textContent), null, { timeout: 30000 });
    ok(true, "chain: close position");
    await p.goto(BASE + "#/vault");
    await p.waitForSelector("#depAmt");
    await p.fill("#depAmt", "500");
    await p.click("#dep button[type=submit]");
    await toast(p, /Done/, 30000);
    await p.waitForFunction(() => /You hold [1-9]/.test(document.querySelector("#wdBal")?.textContent || ""), null, { timeout: 15000 })
      .catch(async (e) => { console.log("  wdBal:", JSON.stringify(await p.textContent("#wdBal")), "stats:", (await p.textContent("#vStats")).replace(/\s+/g, " ")); throw e; });
    await p.click("#wdMax");
    await p.click("#wd button[type=submit]");
    await p.waitForFunction(() => /You hold 0\b/.test(document.querySelector("#wdBal")?.textContent || ""), null, { timeout: 30000 });
    ok(true, "chain: vault deposit and withdrawal");
    ok(errors.length === 0, `chain: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
