require("@nomicfoundation/hardhat-toolbox");

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    bittensorTestnet: { url: "https://test.chain.opentensor.ai", chainId: 945, accounts },
    bittensor: { url: "https://lite.chain.opentensor.ai", chainId: 964, accounts },
  },
};
