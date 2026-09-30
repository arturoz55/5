// End-to-end audit: drives the site in Chromium against the demo network and a local Hardhat chain.
// Usage: npx hardhat node & npx hardhat run scripts/deploy.js --network localhost && npx http-server site -p 8080 & node tests/e2e.js
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:8080/";
const RPC = "http://127.0.0.1:8545";
const OUT = process.env.SHOTS || "shots";
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (c, m) => { console.log(`${c ? "✔" : "✘"} ${m}`); if (!c) failures++; };

async function newPage(browser, { wallet, net, width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (net) await ctx.addInitScript((n) => { if (!sessionStorage.getItem("tf-init")) { localStorage.clear(); localStorage.setItem("tf-net", n); sessionStorage.setItem("tf-init", "1"); } }, net);
  if (wallet) {
    await ctx.addInitScript(({ rpc, acct }) => {
      let id = 0;
      const listeners = {};
      window.ethereum = {
        isMetaMask: true,
        on: (e, f) => { (listeners[e] ||= []).push(f); },
        removeListener() {},
        async request({ method, params }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
          return j.result;
        },
      };
    }, wallet);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  if (process.env.DEBUG) page.on("console", (m) => console.log("  [console]", m.type(), m.text().slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|coingecko|ERR_|net::|Failed to load resource/i.test(m.text())) errors.push("console: " + m.text()); });
  return { page, errors, ctx };
}

async function noOverflow(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(w <= 0, `${label}: no horizontal overflow (${w}px)`);
}

async function waitToast(page, re, timeout = 20000) {
  await page.waitForFunction((src) => [...document.querySelectorAll(".toast b")].some((b) => new RegExp(src).test(b.textContent)), re.source, { timeout })
    .catch(async (e) => { console.log("  toasts:", await page.locator(".toast").allTextContents(), "button:", await page.textContent("#tGo").catch(() => "")); throw e; });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

  // ───────── demo network ─────────
  {
    const { page, errors } = await newPage(browser, { net: "demo" });
    await page.goto(BASE + "#/");
    await page.waitForSelector("#homeGrid .mcard", { timeout: 10000 });
    ok((await page.locator("#homeGrid .mcard").count()) === 6, "demo: home shows 6 market cards");
    ok(/demo network/i.test(await page.textContent("#banner")), "demo: banner explains simulation");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/home-desktop.png` });
    await page.screenshot({ path: `${OUT}/home-full.png`, fullPage: true });
    await noOverflow(page, "demo home desktop");

    await page.click('#homeTabs button[data-tab="candidates"]');
    const kinds = await page.locator("#homeGrid .mcard .tag--ember").allTextContents();
    ok(kinds.length > 0 && kinds.every((k) => k.includes("Candidate")), "demo: candidates tab filters");

    await page.goto(BASE + "#/markets?sector=agents");
    await page.waitForSelector("#mGrid .mcard");
    const secTags = await page.locator("#mGrid .mcard .mcard__tags .tag:nth-child(2)").allTextContents();
    ok(secTags.length > 0 && secTags.every((t) => t === "Agents"), "demo: sector filter via URL");
    await page.click('#mSectors button[data-sector=""]');
    await page.fill("#mSearch", "wire");
    await page.waitForTimeout(300);
    ok((await page.locator("#mGrid .mcard").count()) === 1, "demo: search narrows to one");
    await page.screenshot({ path: `${OUT}/markets.png` });

    // token page and trade
    await page.goto(BASE + "#/markets");
    await page.waitForSelector("#mGrid .mcard");
    await page.locator("#mGrid .mcard").first().click();
    await page.waitForSelector("#tGo");
    ok((await page.textContent("#tGo")).includes("Connect"), "demo: trade button asks to connect");
    await page.click("#tGo");
    await page.waitForFunction(() => /Buy|Enter/.test(document.querySelector("#tGo").textContent));
    await page.fill("#tIn", "2");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    const est = await page.inputValue("#tOut");
    ok(Number(est.replace(/,/g, "")) > 0, `demo: buy quote shows ${est}`);
    await page.click("#tGo");
    await waitToast(page, /Trade confirmed/);
    ok(true, "demo: buy confirmed");
    await page.click('#tMode button[data-m="sell"]');
    await page.waitForSelector("#tMax");
    await page.click("#tMax");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    await page.click("#tGo");
    await page.waitForFunction(() => [...document.querySelectorAll(".toast b")].filter((b) => /Trade confirmed/.test(b.textContent)).length >= 1 && document.querySelector("#tBalIn") && /Balance 0(?![.\d₀-₉])/.test(document.querySelector("#tBalIn").textContent), null, { timeout: 20000 });
    ok(true, "demo: sold entire balance");
    await page.screenshot({ path: `${OUT}/token.png`, fullPage: true });

    // insufficient balance guard
    await page.click('#tMode button[data-m="buy"]');
    await page.fill("#tIn", "99999");
    await page.waitForFunction(() => /Insufficient/.test(document.querySelector("#tGo").textContent));
    ok(await page.isDisabled("#tGo"), "demo: insufficient balance disables trade");

    // create
    await page.goto(BASE + "#/create?kind=Subnet%20Coin&netuid=64");
    await page.waitForSelector("#cForm");
    await page.fill("#cName", "<img src=x onerror=alert(1)> Audit");
    await page.fill("#cSym", "aud1t");
    ok((await page.inputValue("#cSym")) === "AUD1T", "demo: ticker uppercases");
    await page.fill("#cDesc", "Created by the automated audit. <script>alert(1)</script>");
    await page.fill("#cImg", "javascript:alert(1)");
    await page.fill("#cLiq", "3");
    await page.check("#cAck");
    await page.waitForFunction(() => !document.querySelector("#cSubmit").disabled);
    await page.click("#cSubmit");
    await waitToast(page, /Check the form/);
    ok(true, "demo: rejects javascript: image URL");
    await page.fill("#cImg", "");
    await page.click("#cSubmit");
    await page.waitForFunction(() => /#\/token\/0x/.test(location.hash), null, { timeout: 15000 });
    await page.waitForSelector(".tokenhead h1");
    const h1 = await page.textContent(".tokenhead h1");
    ok(h1.includes("<img"), "demo: user HTML is rendered as text (escaped)");
    ok((await page.locator(".tokenhead img").count()) === 0, "demo: no injected <img> element");
    ok((await page.textContent(".tokenhead")).includes("SN64"), "demo: netuid shown");
    ok((await page.textContent("#tTrades")).includes("No trades yet"), "demo: fresh market has no trades");

    // lookup
    await page.goto(BASE + "#/markets");
    await page.fill("#lookupInput", "0x0000000000000000000000000000000000000001");
    await page.click("#lookupForm button");
    await waitToast(page, /Not found/);
    ok(true, "demo: lookup reports unknown token");

    for (const r of ["#/subnets", "#/docs", "#/risk", "#/fund", "#/nope"]) {
      await page.goto(BASE + r);
      await page.waitForTimeout(400);
      ok((await page.locator("main .display, main .empty").count()) > 0, `demo: ${r} renders`);
    }
    await page.goto(BASE + "#/subnets");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/subnets.png` });
    await page.goto(BASE + "#/create");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/create.png`, fullPage: true });
    ok(errors.length === 0, `demo: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ───────── mobile ─────────
  {
    const { page, errors } = await newPage(browser, { net: "demo", width: 390, height: 844 });
    await page.goto(BASE + "#/");
    await page.waitForSelector("#homeGrid .mcard");
    await page.waitForTimeout(1000);
    await noOverflow(page, "mobile home");
    await page.screenshot({ path: `${OUT}/home-mobile.png` });
    await page.click("#burger");
    await page.waitForTimeout(500);
    ok(await page.isVisible('#mobileMenu a[href="#/create"]'), "mobile: menu opens");
    await page.screenshot({ path: `${OUT}/menu-mobile.png` });
    await page.click('#mobileMenu a[href="#/markets"]');
    await page.waitForSelector("#mGrid .mcard");
    await noOverflow(page, "mobile markets");
    await page.locator("#mGrid .mcard").first().click();
    await page.waitForSelector("#tGo");
    await page.waitForTimeout(600);
    await noOverflow(page, "mobile token");
    await page.goto(BASE + "#/create");
    await page.waitForSelector("#cForm");
    await noOverflow(page, "mobile create");
    ok(errors.length === 0, `mobile: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ───────── local chain with injected wallet ─────────
  {
    const acct = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // hardhat #3
    const { page, errors } = await newPage(browser, { net: "local", wallet: { rpc: RPC, acct } });
    await page.goto(BASE + "#/");
    await page.waitForSelector("#homeGrid .mcard", { timeout: 15000 });
    const n = await page.locator("#homeGrid .mcard").count();
    ok(n >= 4, `chain: home lists ${n} on-chain launches`);
    await page.click("#walletBtn");
    await page.waitForFunction(() => /0x90F7/.test(document.querySelector("#walletLabel").textContent));
    ok(true, "chain: wallet connects");

    // create a TAO launch
    await page.goto(BASE + "#/create");
    await page.waitForSelector("#cForm");
    await page.fill("#cName", "Chain Audit");
    await page.fill("#cSym", "CHAIN");
    await page.fill("#cLiq", "5");
    await page.check("#cAck");
    await page.waitForFunction(() => !document.querySelector("#cSubmit").disabled);
    await page.click("#cSubmit");
    await page.waitForFunction(() => /#\/token\/0x/.test(location.hash), null, { timeout: 30000 }).catch(async (e) => { console.log("toasts:", await page.locator(".toast").allTextContents(), page.url(), await page.evaluate(() => ({ btn: document.querySelector("#cSubmit")?.outerHTML, acct: window.TF_APP.state.be.account, net: window.TF_APP.state.net.key, bad: [...document.querySelectorAll(".is-bad")].map((x) => x.id) }))); await page.screenshot({ path: OUT + "/fail.png", fullPage: true }); throw e; });
    await page.waitForSelector(".tokenhead h1");
    ok((await page.textContent(".tokenhead h1")) === "Chain Audit", "chain: launch created and opened");

    // buy
    await page.waitForFunction(() => /Enter an amount|Buy/.test(document.querySelector("#tGo").textContent));
    await page.fill("#tIn", "1");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    await page.click("#tGo");
    await waitToast(page, /Trade confirmed/, 30000);
    await page.waitForFunction(() => document.querySelectorAll("#tTrades tr td.up").length >= 1, null, { timeout: 15000 });
    ok(true, "chain: buy confirmed and indexed from Swap events");

    // sell half (exercises approve + sell)
    await page.click('#tMode button[data-m="sell"]');
    await page.waitForSelector("#tMax");
    await page.click("#tMax");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    await page.click("#tGo");
    await waitToast(page, /Trade confirmed/, 30000);
    await page.waitForFunction(() => document.querySelectorAll("#tTrades tr td.down").length >= 1, null, { timeout: 15000 });
    ok(true, "chain: approve + sell confirmed");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/token-chain.png`, fullPage: true });

    // alpha launch: needs wSN10 balance, minted by the test harness beforehand
    await page.goto(BASE + "#/create?pair=alpha");
    await page.waitForSelector("#cQuote button:nth-child(2)");
    await page.fill("#cName", "Alpha Audit");
    await page.fill("#cSym", "AAUD");
    await page.fill("#cLiq", "2");
    await page.check("#cAck");
    await page.waitForFunction(() => !document.querySelector("#cSubmit").disabled);
    await page.click("#cSubmit");
    await page.waitForFunction(() => /#\/token\/0x/.test(location.hash), null, { timeout: 30000 }).catch(async (e) => { console.log("toasts:", await page.locator(".toast").allTextContents(), page.url(), await page.evaluate(() => ({ btn: document.querySelector("#cSubmit")?.outerHTML, acct: window.TF_APP.state.be.account, net: window.TF_APP.state.net.key, bad: [...document.querySelectorAll(".is-bad")].map((x) => x.id) }))); await page.screenshot({ path: OUT + "/fail.png", fullPage: true }); throw e; });
    await page.waitForSelector(".tokenhead h1");
    ok((await page.textContent(".tokenhead .tag")).includes("wSN10"), "chain: alpha-paired launch (approve + create)");
    await page.fill("#tIn", "0.5");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    await page.click("#tGo");
    await waitToast(page, /Trade confirmed/, 30000);
    ok(true, "chain: buy with alpha reserve");
    // let the post-trade refresh finish (it clears the input) before starting the next trade
    await page.waitForFunction(() => document.querySelector("#tIn").value === "" && /Enter an amount/.test(document.querySelector("#tGo").textContent), null, { timeout: 15000 });

    // slippage failure is surfaced nicely
    await page.fill("#tIn", "0.5");
    await page.waitForFunction(() => document.querySelector("#tOut").value !== "");
    await page.waitForFunction(() => /^Buy/.test(document.querySelector("#tGo").textContent));
    await page.evaluate(() => { const b = document.querySelector("#tGo"); b.dataset.min = (10n ** 30n).toString(); b.click(); });
    await waitToast(page, /Trade failed/, 30000);
    const msg = await page.locator(".toast--err .muted").last().textContent();
    ok(/slippage/i.test(msg), `chain: slippage revert decoded -> "${msg}"`);

    // lookup by real address
    await page.goto(BASE + "#/markets");
    await page.waitForSelector("#mGrid .mcard");
    const href = await page.locator("#mGrid .mcard").first().getAttribute("href");
    await page.fill("#lookupInput", href.split("/").pop());
    await page.click("#lookupForm button");
    await page.waitForFunction(() => /#\/token\/0x/.test(location.hash));
    ok(true, "chain: lookup by token address");
    ok(errors.length === 0, `chain: no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  // ───────── undeployed network ─────────
  {
    const { page, errors } = await newPage(browser, { net: "bittensor" });
    await page.goto(BASE + "#/");
    await page.waitForSelector("#homeGrid .empty", { timeout: 15000 });
    ok(/isn't deployed/.test(await page.textContent("#banner")), "mainnet (undeployed): banner offers demo");
    await page.goto(BASE + "#/create");
    await page.waitForSelector("#cSubmit");
    ok(await page.isDisabled("#cSubmit"), "mainnet (undeployed): create disabled");
    ok(errors.length === 0, `mainnet (undeployed): no JS errors ${errors.length ? JSON.stringify(errors) : ""}`);
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
