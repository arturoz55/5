// Local price keeper: pushes a gentle random walk for every market on an interval.
// A production keeper would push prices from a licensed market-data feed instead.
//   npx hardhat run scripts/keeper.js --network localhost      (INTERVAL=ms, ROUNDS=n)
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const MARKETS = require("./markets");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "site", "js", "deployments.js"), "utf8").match(/=\s*(\{[\s\S]*\});?\s*$/)[1])[String(chainId)];
  const oracle = await ethers.getContractAt("PriceOracle", dep.oracle);
  const rounds = Number(process.env.ROUNDS || Infinity);
  const every = Number(process.env.INTERVAL || 4000);
  const px = await Promise.all(MARKETS.map(async (_, i) => Number((await oracle.latest(i))[0]) / 1e8));
  for (let r = 0; r < rounds; r++) {
    px.forEach((p, i) => { px[i] = Math.max(0.5, p * (1 + (Math.random() - 0.5) * 0.01)); });
    await (await oracle.push(MARKETS.map((_, i) => i), px.map((p) => ethers.parseUnits(p.toFixed(6), 8)))).wait();
    if (r + 1 < rounds) await new Promise((res) => setTimeout(res, every));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
