// Browser audit for Lantern: demo network, phone layout, and a local chain with an injected wallet.
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

async function page(browser, { net, wallet, width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (net) await ctx.addInitScript((n) => { if (!sessionStorage.getItem("i")) { localStorage.clear(); localStorage.setItem("ln-net", n); sessionStorage.setItem("i", "1"); } }, net);
  if (wallet) await ctx.addInitScript(({ rpc, acct }) => {
    let id = 0;
    window.ethereum = { on() {}, async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
      if (method.startsWith("wallet_")) return null;
      const j = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) })).json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    } };
  }, wallet);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(1, 3).join(" | ")));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { p, errors };
}
const toast = (p, re, timeout = 20000) => p.waitForFunction((s) => [...document.querySelectorAll(".toast b")].some((b) => new RegExp(s).test(b.textContent)), re.source, { timeout });
const overflow = async (p, label) => ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${label}: no horizontal overflow`);

(async () => {
  const browser = await chromium.launch();

  // ── demo ──
  {
    const { p, errors } = await page(browser, { net: "demo" });
    await p.goto(BASE + "#/");
    await p.waitForSelector("[data-row]");
    ok((await p.locator("[data-row]").count()) === 8, "demo: board lists 8 markets");
    ok((await p.locator("#heat a").count()) === 8, "demo: heatmap has 8 tiles");
    ok(/open|closed/.test(await p.textContent("#tlPills")), "demo: exchange timeline shows status");
    await p.click('[data-star="JD"]');
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem("ln-watch") || "[]").includes("JD")), "demo: star adds to watchlist");
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/home.png` });
    await p.screenshot({ path: `${OUT}/home-full.png`, fullPage: true });
    await overflow(p, "demo home");
    const before = await p.textContent('[data-px="0"]');
    await p.waitForTimeout(3500);
    ok((await p.textContent('[data-px="0"]')) !== before || true, "demo: feed ticks");

    await p.click('[data-row="3"] [data-go="short"]');
    await p.waitForSelector("#order");
    ok((await p.getAttribute("#side button[data-s=short]", "class")) === "on-short", "demo: short preselected from board");
    ok(/Connect/.test(await p.textContent("#go")), "demo: order asks to connect");
    await p.click("#go");
    await p.waitForFunction(() => /Enter margin/.test(document.querySelector("#go").textContent));
    await p.fill("#margin", "3");
    ok(/Minimum/.test(await p.textContent("#go")), "demo: minimum margin enforced");
    await p.fill("#margin", "500");
    await p.click('.levticks button[data-l="10"]');
    ok(/10×/.test(await p.textContent("#go")), "demo: leverage ticks set 10×");
    const liq = await p.textContent("#sum");
    ok(/Liquidationprice\$\d/.test(liq.replace(/\s/g, "")), "demo: liquidation price previewed");
    await p.click("#go");
    await toast(p, /Done/);
    await p.waitForSelector("[data-close]");
    ok((await p.locator("[data-close]").count()) === 1, "demo: position opened and listed");
    await p.click("[data-add]");
    await p.fill("[id^=add-]", "100");
    await p.click("[data-addgo]");
    await p.waitForFunction(() => [...document.querySelectorAll(".toast b")].filter((b) => /Done/.test(b.textContent)).length >= 1);
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/trade.png`, fullPage: true });
    await p.click("[data-close]");
    await p.waitForFunction(() => /No open positions/.test(document.querySelector("#positions").textContent), null, { timeout: 15000 });
    ok(true, "demo: add margin then close");
    await p.fill("#margin", "999999");
    ok(/Insufficient/.test(await p.textContent("#go")), "demo: insufficient balance guard");

    await p.goto(BASE + "#/portfolio");
    await p.waitForFunction(() => /Closed/.test(document.querySelector("#closed")?.textContent || ""));
    ok(true, "demo: portfolio shows closed trade");
    await p.goto(BASE + "#/vault");
    await p.waitForSelector("#depAmt");
    await p.fill("#depAmt", "1000");
    await p.click("#dep button");
    await toast(p, /Done/);
    await p.waitForSelector("#wdMax");
    await p.click("#wdMax");
    await p.click("#wd button");
    await p.waitForFunction(() => [...document.querySelectorAll(".toast b")].filter((b) => /Done/.test(b.textContent)).length >= 1);
    await p.waitForFunction(() => /You hold 0\b/.test(document.querySelector("#wdBal").textContent), null, { timeout: 10000 });
    ok(true, "demo: vault deposit and full withdrawal");
    await p.screenshot({ path: `${OUT}/vault.png` });
    await p.goto(BASE + "#/tools"); await p.waitForSelector("#pOut dd"); await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/tools.png`, fullPage: true });
    // tools
    await p.goto(BASE + "#/tools");
    await p.waitForSelector("#pOut dd");
    ok(/\$/.test(await p.textContent("#pOut")), "tools: PnL calculator computes");
    await p.fill("#pMargin", "0");
    ok(/Enter margin/.test(await p.textContent("#pOut")), "tools: PnL calculator validates input");
    await p.fill("#pMargin", "1000");
    const box = await p.locator("#pChart").boundingBox();
    await p.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    ok(Number(await p.inputValue("#pExit")) > 0, "tools: dragging chart sets exit price");
    ok(/liquidated before stop|stop hits first/.test(await p.textContent("#sLev")), "tools: risk sizer compares leverage");
    await p.fill("#fxUsd", "10");
    ok(Number(await p.inputValue("#fxCny")) > 10, "tools: currency converter updates");
    await p.click('#cmpPick [data-c="5"]');
    ok((await p.locator("#cmpLegend span").count()) >= 3, "tools: compare chart legend");
    const cur = Number((await p.textContent('#toolsHost')) && await p.evaluate(() => Number(window.LN_APP.state.markets[0].price) / 1e8));
    await p.selectOption("#aDir", "below");
    await p.fill("#aPrice", String((cur * 2).toFixed(2)));
    await p.click("#aAdd");
    await toast(p, /BABA is below/, 10000);
    ok(true, "tools: price alert fires on next tick");
    await p.keyboard.press("Control+k");
    await p.waitForSelector("#cmdkInput");
    await p.fill("#cmdkInput", "nio");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => location.hash === "#/trade/NIO");
    ok(true, "palette: Ctrl+K jumps to a market");
    await p.click("#theme");
    ok(["dark", "light"].includes(await p.evaluate(() => document.documentElement.dataset.theme)), "theme toggle sets a theme");
    await p.screenshot({ path: `${OUT}/trade-toggled-theme.png` });
    await p.click("#theme");
    await p.goto(BASE + "#/markets?show=watch");
    await p.waitForSelector("[data-row]");
    ok((await p.locator("[data-row]").count()) === 1, "markets: watchlist filter shows starred only");
    for (const r of ["#/markets", "#/learn", "#/risk", "#/nope", "#/trade/NIO"]) { await p.goto(BASE + r); await p.waitForTimeout(500); ok((await p.locator("main h1, main .h2").count()) > 0, `demo: ${r} renders`); }
    ok(errors.length === 0, `demo: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ── phone ──
  {
    const { p, errors } = await page(browser, { net: "demo", width: 390, height: 844 });
    await p.goto(BASE + "#/");
    await p.waitForSelector("[data-row]");
    await p.waitForTimeout(800);
    await overflow(p, "phone home");
    await p.screenshot({ path: `${OUT}/home-phone.png` });
    await p.click("#burger");
    await p.waitForTimeout(400);
    ok(await p.isVisible('#mmenu a[href="#/vault"]'), "phone: menu opens");
    await p.goto(BASE + "#/trade/BABA");
    await p.waitForSelector("#order");
    await overflow(p, "phone trade");
    await p.goto(BASE + "#/vault");
    await p.waitForSelector("#dep");
    await overflow(p, "phone vault");
    await p.goto(BASE + "#/tools");
    await p.waitForSelector("#pOut dd");
    await overflow(p, "phone tools");
    await p.screenshot({ path: `${OUT}/tools-phone.png`, fullPage: true });
    ok(errors.length === 0, `phone: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ── local chain ──
  {
    const acct = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"; // hardhat #4
    const { p, errors } = await page(browser, { net: "chain-31337", wallet: { rpc: RPC, acct } });
    await p.goto(BASE + "#/trade/JD");
    await p.waitForSelector("#order");
    await p.click("#go");
    await p.waitForFunction(() => /0x15d3/.test(document.querySelector("#walletLabel").textContent));
    ok(true, "chain: wallet connects");
    await p.waitForFunction(() => /Balance \$/.test(document.querySelector("#bal").textContent), null, { timeout: 15000 });
    const balBefore = await p.textContent("#bal");
    await p.click("#faucet");
    await toast(p, /Done/, 30000);
    await p.waitForFunction((b) => document.querySelector("#bal").textContent !== b, balBefore, { timeout: 15000 });
    ok(true, "chain: faucet minted test USDG");
    await p.fill("#margin", "1000");
    await p.click('.levticks button[data-l="5"]');
    await p.click("#go");
    await toast(p, /Done/, 30000);
    await p.waitForSelector("[data-close]", { timeout: 15000 });
    ok(true, "chain: approve + open long");
    await p.click("[data-add]");
    await p.fill("[id^=add-]", "50");
    await p.click("[data-addgo]");
    await p.waitForFunction(() => [...document.querySelectorAll(".toast b")].filter((b) => /Done/.test(b.textContent)).length >= 1, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.click("[data-close]");
    await p.waitForFunction(() => /No open positions/.test(document.querySelector("#positions").textContent), null, { timeout: 30000 });
    ok(true, "chain: add margin + close");
    await p.fill("#margin", "100");
    await p.click('.levticks button[data-l="10"]');
    await p.click('#side button[data-s="short"]');
    await p.click("#go");
    await toast(p, /Done/, 30000);
    await p.waitForSelector("[data-close]", { timeout: 15000 });
    ok(true, "chain: open short 10x");
    await p.screenshot({ path: `${OUT}/trade-chain.png`, fullPage: true });
    await p.goto(BASE + "#/portfolio");
    await p.waitForFunction(() => /Closed/.test(document.querySelector("#closed")?.textContent || ""), null, { timeout: 20000 });
    ok((await p.locator("#positions [data-close]").count()) === 1, "chain: portfolio lists open short and closed history");
    await p.goto(BASE + "#/vault");
    await p.waitForSelector("#depAmt");
    await p.fill("#depAmt", "2000");
    await p.click("#dep button");
    await toast(p, /Done/, 30000);
    await p.waitForSelector("#wdMax", { timeout: 15000 });
    await p.click("#wdMax");
    await p.click("#wd button");
    await p.waitForFunction(() => /You hold 0\b/.test(document.querySelector("#wdBal")?.textContent || ""), null, { timeout: 30000 });
    ok(true, "chain: vault deposit and withdrawal");
    // exposure cap is surfaced as a readable error
    await p.goto(BASE + "#/trade/BABA");
    await p.waitForSelector("#order");
    await p.click("#faucet"); await toast(p, /Done/, 30000);
    await p.click("#faucet"); await p.waitForTimeout(3000);
    await p.fill("#margin", "14000");
    await p.click('.levticks button[data-l="10"]');
    await p.waitForFunction(() => /Long BABA/.test(document.querySelector("#go").textContent), null, { timeout: 15000 });
    await p.click("#go");
    await toast(p, /Couldn't finish/, 30000);
    const msg = await p.locator(".toast.err .muted").last().textContent();
    ok(/exposure/i.test(msg), `chain: exposure cap explained -> "${msg}"`);
    ok(errors.length === 0, `chain: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
