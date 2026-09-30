require("@nomicfoundation/hardhat-toolbox");

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    // any EVM chain: RPC_URL=https://... DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network custom
    custom: { url: process.env.RPC_URL || "http://127.0.0.1:8545", accounts },
  },
};
