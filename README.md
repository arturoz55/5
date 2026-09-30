# Tensorforge

Launch a fixed-supply token with a permanently locked pool against native TAO or a supported
subnet-alpha wrapper on Bittensor EVM, then discover and trade launches in one place.

- **Contracts** (`contracts/`): `ForgeFactory` deploys a `ForgeToken` (plain ERC-20, whole supply
  minted into the pool, no owner/mint/tax) and a `ForgePool` (constant-product AMM, no LP shares,
  no withdraw — liquidity is locked forever). 1% fee per trade: 0.5% to the treasury, 0.5% stays
  in the pool.
- **Site** (`site/`): static HTML/CSS/JS, no build step. Talks to the chain with ethers v6 and any
  EIP-1193 wallet. Includes an in-browser **demo network** that mirrors the contract math exactly,
  so everything can be tried without funds.

## Develop

```bash
npm install
npx hardhat test                                   # contract tests
npx hardhat node                                   # local chain (terminal 1)
npx hardhat run scripts/deploy.js --network localhost   # deploy + seed demo launches
npx hardhat run scripts/fund-test.js --network localhost  # give the e2e account mock alpha
npx http-server site -p 8080                       # serve the site
node tests/e2e.js                                  # browser audit (demo, mobile, local chain)
```

## Deploy

```bash
DEPLOYER_KEY=0x… TREASURY=0x… npx hardhat run scripts/deploy.js --network bittensorTestnet
DEPLOYER_KEY=0x… TREASURY=0x… npx hardhat run scripts/deploy.js --network bittensor
```

The script writes the factory address to `site/js/deployments.js`; the site switches from the
demo network to the live chain automatically. Allow-list alpha wrappers with
`ForgeFactory.setQuoteAsset(asset, label, true, minLiquidity)`.

The contracts are tested but **not audited**. See `#/risk` on the site.

## License

MIT — see `LICENSE`.
