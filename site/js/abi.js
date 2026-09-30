// Minimal human-readable ABIs used by the frontend.
window.TF_ABI = {
  factory: [
    "function createLaunch((string name,string symbol,uint256 supply,string metadata,address quote,uint256 quoteAmount) p) payable returns (address token, address pool)",
    "function launchCount() view returns (uint256)",
    "function launchFee() view returns (uint256)",
    "function minNativeLiquidity() view returns (uint256)",
    "function minQuoteLiquidity(address) view returns (uint256)",
    "function getLaunches(uint256 offset, uint256 limit) view returns (tuple(address token,address pool,address quote,address creator,uint64 createdAt,string name,string symbol,string metadata,uint256 totalSupply,uint256 reserveToken,uint256 reserveQuote)[])",
    "function getLaunchByToken(address token) view returns (uint256 id, tuple(address token,address pool,address quote,address creator,uint64 createdAt,string name,string symbol,string metadata,uint256 totalSupply,uint256 reserveToken,uint256 reserveQuote) v)",
    "function quoteAssets() view returns (tuple(address asset,string label,bool allowed)[])",
    "event LaunchCreated(uint256 indexed id, address indexed token, address indexed creator, address pool, address quote, uint256 supply, uint256 quoteAmount)",
  ],
  pool: [
    "function quoteBuy(uint256) view returns (uint256)",
    "function quoteSell(uint256) view returns (uint256)",
    "function buy(uint256 minOut, address to, uint256 deadline) payable returns (uint256)",
    "function buyWithQuote(uint256 quoteIn, uint256 minOut, address to, uint256 deadline) returns (uint256)",
    "function sell(uint256 tokensIn, uint256 minOut, address to, uint256 deadline) returns (uint256)",
    "function reserveToken() view returns (uint256)",
    "function reserveQuote() view returns (uint256)",
    "event Initialized(address indexed token, uint256 reserveToken, uint256 reserveQuote)",
    "event Swap(address indexed trader, address indexed to, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 reserveQuote, uint256 reserveToken)",
  ],
  erc20: [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ],
};
