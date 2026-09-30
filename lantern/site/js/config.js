// Lantern — static configuration
window.LN_CONFIG = {
  brand: "Lantern",
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
  demo: { name: "Demo network", startBalance: 10000, vault: 250000 },
};
