const { expect } = require("chai");
const hre = require("hardhat");
const {
  USDT_address,
  FRAX_address,
  DAI_address,
  UniswapV2Router2_address,
  Gains_address,
  USDC_address,
  GTokenOpenFeed_address,
} = require("../data");
const gains_abi = require("../abis/gains_abi");
const gTokenOpenFeed_abi = require("../abis/gTokenOpenFeed_abi");

describe("Reward Split Test Case 3: ", function () {
  let Whiskey;
  let Water;
  let USDC;
  let DAI;
  let gDAI;
  let GainsManager;
  let ceo;
  let admin;
  let feeReceiver;
  let user1;
  let user2;
  let user3;
  let user4;
  let user5;

  let countDownPeriod;

  const depositAmount = hre.ethers.utils.parseUnits("10000", 6);

  const startNewEpoch = async () => {
    await hre.ethers.provider.send("evm_increaseTime", [86400*3]);
    await hre.ethers.provider.send("evm_mine", []);
    await GainsManager.forceNewEpoch();
  }

  before(async function () {
    [ceo, admin, feeReceiver, user1, user2, user3, user4, user5] = await hre.ethers.getSigners();

    // USDC token
    const usdc_whale = "0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B";
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdc_whale],
    });
    const USDC_Whale = await hre.ethers.getSigner(usdc_whale);
    USDC = await hre.ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      USDC_address,
      USDC_Whale
    );
    DAI = await hre.ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      DAI_address,
    );
    gDAI = await hre.ethers.getContractAt(
      gains_abi,
      Gains_address,
    );
    // fund the whale's wallet with gas
    await ceo.sendTransaction({
      to: usdc_whale,
      value: hre.ethers.utils.parseEther("10"),
    });

    // Transfer USDC to users
    const transferAmount = hre.ethers.utils.parseUnits("100000", 6);
    await USDC.transfer(user1.address, transferAmount);
    await USDC.transfer(user2.address, transferAmount);
    await USDC.transfer(user3.address, transferAmount);
    await USDC.transfer(user4.address, transferAmount);
    await USDC.transfer(user5.address, transferAmount);

    // GetContractAt gTokenOpenFeed contract of Gains network
    GainsManager = await hre.ethers.getContractAt(
      gTokenOpenFeed_abi,
      GTokenOpenFeed_address
    );

    // LeverageVault contract deploy
    const waterContract = await hre.ethers.getContractFactory(
      "contracts/LendingVault.sol:LendingVault"
    );
    Water = await waterContract.deploy(
      "Lending Vault",
      "Water",
      DAI_address,
      UniswapV2Router2_address,
      feeReceiver.address,
      admin.address,
      [USDC_address, USDT_address, FRAX_address]
    );

    // LeverageVault contract deploy
    const whiskeyContract = await hre.ethers.getContractFactory(
      "contracts/LeverageVault.sol:LeverageVault"
    );
    Whiskey = await whiskeyContract.deploy(
      DAI_address,
      UniswapV2Router2_address,
      Gains_address,
      Water.address,
      feeReceiver.address,
      admin.address,
      [USDC_address, USDT_address, FRAX_address]
    );

    await Water.connect(ceo).changeLeverageVault(Whiskey.address);
  });

  describe("Testing", function () {
    it("Start new epoch for correct test", async function () {
      await startNewEpoch();
    });

    it("Initial deposit", async function () {
      console.log('Current Reward split ratio: (expect)', '1250 (12.5%)');
      // Water deposit 10000 USDC
      await USDC.connect(user1).approve(Water.address, depositAmount);
      await Water.connect(user1).depositStableCoin(USDC.address, depositAmount, user1.address);
      // Whiskey deposit 1000 USDC
      await USDC.connect(user1).approve(Whiskey.address, 1000e6);
      await Whiskey.connect(user1).deposit(USDC.address, 1000e6, 200);

      console.log('Current Reward split ratio: ', await Water.rewardSplit());
    });
  });
});
