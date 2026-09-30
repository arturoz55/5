// Nightfall — static configuration
window.LN_CONFIG = {
  brand: "Nightfall",
  collateral: { symbol: "USDG", decimals: 6 },
  // Order must match scripts/markets.js (market ids are array indexes on chain).
  markets: [
    { symbol: "BABA", name: "Alibaba Group", sector: "E-commerce & cloud", seed: 118, hue: 24 },
    { symbol: "PDD", name: "PDD Holdings", sector: "E-commerce", seed: 112, hue: 4 },
    { symbol: "JD", name: "JD.com", sector: "Retail & logistics", seed: 34, hue: 350 },
    { symbol: "BIDU", name: "Baidu", sector: "Search & AI", seed: 92, hue: 222 },
    { symbol: "NTES", name: "NetEase", sector: "Games", seed: 128, hue: 0 },
    { symbol: "BILI", name: "Bilibili", sector: "Video", seed: 22, hue: 196 },
    { symbol: "LI", name: "Li Auto", sector: "Electric vehicles", seed: 24, hue: 160 },
    { symbol: "NIO", name: "NIO", sector: "Electric vehicles", seed: 5.4, hue: 190 },
  ],
  // Community token, live on Robinhood Chain (the trading desk itself opens at launch).
  token: {
    name: "Nightfall", symbol: "NIGHTFALL", decimals: 18, supply: 1000000000,
    address: "0x667fffd7e7aa22bc279f03d122cf5d7aedc449f4",
    chainId: 4663, chainName: "Robinhood Chain", rpc: "https://rpc.mainnet.chain.robinhood.com/rpc",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  demo: { name: "Demo network", startBalance: 10000, vault: 250000 },
};
