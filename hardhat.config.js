require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require('@openzeppelin/hardhat-upgrades');
require("dotenv").config();
require("hardhat-gas-reporter");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const ALCHEMY_API_KEY_TEST = process.env.ALCHEMY_KEY_TEST;
const ALCHEMY_API_KEY_MAIN = process.env.ALCHEMY_KEY_MAIN;
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const accounts = [process.env.PRIVATE_KEY];

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: {
        url: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_MAIN}`,
      },
      hardfork: 'london',
    },
    maticmainnet: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_MAIN}`,
      accounts,
      chainId: 137,
    },
    matictestnet: {
      url: `https://polygon-mumbai.g.alchemy.com/v2/${ALCHEMY_API_KEY_TEST}`,
      accounts,
      chainId: 80001,
      gas: "auto",
      gasPrice: 30000000000,
      gasMultiplier: 1.1,
    },
  },
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 5000000,
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_KEY,
  },
};
