# Lantern

Leveraged long/short positions (1–10×) on eight US-listed Chinese companies, margined in USDG
and settled on an EVM chain. A shared liquidity vault is the counterparty to every trade.

- `contracts/PriceOracle.sol`: keeper-fed prices (8 decimals) with a max age and a max move per update.
- `contracts/LanternExchange.sol`: isolated-margin positions, 0.1% open/close fee, liquidation below
  5% equity, and a vault (LNV shares) with a net-exposure cap.
- `site/`: static HTML/CSS/JS with ethers v6. Includes a **demo network** that runs the same integer
  math in the browser with a simulated price feed.

## Develop

```bash
npm install                         # at the repo root (shared node_modules)
cd lantern
npx hardhat test                    # 11 contract tests
npx hardhat node                    # terminal 1 (or reuse one on :8545)
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/keeper.js --network localhost   # optional: live random-walk prices
npx http-server site -p 8090 -c-1
node tests/e2e.js                   # browser audit: demo, phone, local chain
```

## Deploy to a real chain

```bash
RPC_URL=https://… DEPLOYER_KEY=0x… COLLATERAL=0x<USDG> OWNER=0x… KEEPER=0x… \
NAME="Chain name" EXPLORER=https://… npx hardhat run scripts/deploy.js --network custom
```

Then run a keeper that pushes prices from a **licensed** market-data source.
The contracts are tested but **not audited**. Leveraged products referencing equities are regulated
in most jurisdictions; get legal advice before offering this with real funds.

MIT licensed.
