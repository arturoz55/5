// Local only: give hardhat account #3 some mock alpha for the e2e alpha-pair test.
const { ethers } = require("hardhat");
const fs = require("fs");
const readFactory = () => JSON.parse(fs.readFileSync(__dirname + "/../site/js/deployments.js", "utf8").match(/=\s*(\{[\s\S]*\});?\s*$/)[1])["31337"].factory;
async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("ForgeFactory", readFactory());
  const assets = await factory.quoteAssets();
  const alpha = await ethers.getContractAt("MockAlpha", assets[0].asset);
  await (await alpha.mint("0x90F79bf6EB2c4f870365E785982E1f101E93b906", ethers.parseEther("100"))).wait();
  console.log("funded test account with wSN10", deployer.address.slice(0, 6));
}
main().catch((e) => { console.error(e); process.exit(1); });
