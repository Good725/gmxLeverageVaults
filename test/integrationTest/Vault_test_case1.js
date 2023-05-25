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
  USDC_whale_address,
  DAI_whale_address,
} = require("../data");
const { convertFromWei } = require("../utils");
const gains_abi = require("../abis/gains_abi");
const gTokenOpenFeed_abi = require("../abis/gTokenOpenFeed_abi");
const { default: BigNumber } = require("bignumber.js");

describe("General money flow Test Case 1:", function () {
  let Whiskey;
  let Water;
  let USDC;
  let DAI;
  let DAI_Whale;
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
  let lendAmount;
  let daiBalanceOfWater;

  const depositAmount = hre.ethers.utils.parseUnits("10000", 6);
  const transferAmount = hre.ethers.utils.parseUnits("20000", 6);

  const startNewEpoch = async () => {
    await hre.ethers.provider.send("evm_increaseTime", [86400*3]);
    await hre.ethers.provider.send("evm_mine", []);
    await GainsManager.forceNewEpoch();
  }

  before(async function () {
    [ceo, admin, feeReceiver, user1, user2, user3, user4, user5] = await hre.ethers.getSigners();

    // USDC token
    const usdc_whale = USDC_whale_address;
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
    // DAI token
    const dai_whale = DAI_whale_address;
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [dai_whale],
    });
    DAI_Whale = await hre.ethers.getSigner(dai_whale);
    DAI = await hre.ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      DAI_address,
      DAI_Whale
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

    it("Deposit 10000 USDC on Water", async function () {
      await USDC.connect(user1).approve(Water.address, depositAmount);
      await Water.connect(user1).depositStableCoin(USDC.address, depositAmount, user1.address);

      const usdcBalanceOfFeeReceiver = await USDC.balanceOf(feeReceiver.address);
      // Protocol fee receiver address increase 50 USDC
      expect(usdcBalanceOfFeeReceiver).to.equal(50e6);
      console.log('Protocol fee when 10000 USDC deposit: ', usdcBalanceOfFeeReceiver);

      // Current Water price = $1 and amount of Water tokens issued is equal to DAI
      const daiAmount = await DAI.balanceOf(Water.address);
      const waterAmount = await Water.balanceOf(user1.address);
      console.log('Amount of DAI deposited: ', daiAmount);
      console.log('Amount of Water minted: ', waterAmount);
      expect(daiAmount).to.equal(await Water.balanceOfDAI());
      expect(daiAmount).to.equal(waterAmount);
    });

    it("Deposit 10000 USDC on Whiskey", async function () {
      await USDC.connect(user1).approve(Whiskey.address, depositAmount);
      // grey button in frontend (cant deposit) smart contract revert
      // 200 is leverageLevel
      await expect(Whiskey.connect(user1).deposit(USDC.address, depositAmount, 200))
        .to.be.revertedWith("NotEnoughAmount");
    });

    it("Deposit 4100 USDC on Whiskey", async function () {
      await USDC.connect(user1).approve(Whiskey.address, 4100e6);
      // grey button in frontend (cant deposit) smart contract revert
      // 200 is leverageLevel
      await expect(Whiskey.connect(user1).deposit(USDC.address, 4100e6, 200))
        .to.be.revertedWith("NotEnoughAmount");
    });

    it("Deposit 4000 USDC on Whiskey", async function () {
      const feeReceiverBalance = await USDC.balanceOf(feeReceiver.address);
      await USDC.connect(user3).approve(Whiskey.address, 4000e6);

      const daiBalanceOfWaterBeforeDeposit = await DAI.balanceOf(Water.address);
      // grey button in frontend (cant deposit) smart contract revert
      // 200 is leverageLevel
      await Whiskey.connect(user3).deposit(USDC.address, 4000e6, 200);

      lendAmount = daiBalanceOfWaterBeforeDeposit.sub(await DAI.balanceOf(Water.address));
      console.log('DAI amount borrowed when user deposit 4000 USDC:', convertFromWei(lendAmount), 'DAI');

      // Protocol fee receiver address increase 50 USDC
      expect(await USDC.balanceOf(feeReceiver.address)).to.equal(feeReceiverBalance.add(20e6));
      console.log('Protocol fee when 4000 USDC deposit: ', 20, 'USDC');
      console.log('Total Protocol fee amount so far (50 + 20): ', await USDC.balanceOf(feeReceiver.address));
      const gDAIAmount = await gDAI.balanceOf(Whiskey.address);
      console.log('gDAI amount after depositing: ', gDAIAmount);
      console.log('Current gDAI price is ', await Whiskey.gTokenPrice());
      const vaultInfoOfUser3 = await Whiskey.vaultInfoOf(user3.address, USDC.address);
      expect(vaultInfoOfUser3.shares).to.equal(gDAIAmount);
    });

    it("Water and Whiskey contract DAI balance", async function () {
      console.log('USDC amount of fee receiver: ', await USDC.balanceOf(feeReceiver.address));
      console.log('gDAI amount of Whisky contract: ', await gDAI.balanceOf(Whiskey.address));
      console.log('DAI amount of Water contract: ', await DAI.balanceOf(Water.address));
    });

    it("Withdraw request: withdraw 100 USDC from Whiskey immediately after deposit", async function () {
      console.log('Current epoch ID: ', await Whiskey.currentEpoch());
      const withdrawRequestAmount = await Whiskey.availableWithdrawRequestAmount(user3.address, USDC_address);
      console.log('Available withdrawRequest amount:', withdrawRequestAmount);
      await Whiskey.connect(user3).makeWithdrawRequest(USDC_address, withdrawRequestAmount);

      let block = await hre.ethers.provider.getBlock('latest');
      const withdrawEpochsTimelock = await Whiskey.withdrawEpochsTimelock();
      const currentEpochStart = await Whiskey.currentEpochStart();

      // Countdown period = left current epoch time + available withdraw epochs lock times
      // Built by Gain network
      countDownPeriod = 3 * 86400 - (block.timestamp - currentEpochStart) + withdrawEpochsTimelock * 3 * 86400;
      const date = new Date(Date.now() + countDownPeriod * 1000);
      console.log('Countdown Period: ', countDownPeriod, "seconds");
      console.log('Countdown period end date: ', date);
    });

    it("Withdraw 2100 Water from Water", async function () {
      const withdrawWaterAmount = hre.ethers.utils.parseUnits("2100", 18);
      // Can't withdraw due to lend many token to leverage vault so revert right now
      await expect(Water.connect(user1).redeemStableCoin(USDC.address, withdrawWaterAmount, user1.address, user1.address))
        .to.be.revertedWith("NotEnoughAmount");
    });

    it("Withdraw 2000 Water from Water", async function () {
      const withdrawWaterAmount = hre.ethers.utils.parseUnits("2000", 18);
      const totalFeeAmountBefore = await USDC.balanceOf(feeReceiver.address);
      const totalUSDCAmountBefore = await USDC.balanceOf(user1.address);
      // Can't withdraw due to lend many token to leverage vault so revert right now
      await Water.connect(user1).redeemStableCoin(USDC.address, withdrawWaterAmount, user1.address, user1.address);
      const feeAmount = 10e6; // 0.5% of 2000
      const totalFeeAmountAfter = await USDC.balanceOf(feeReceiver.address);
      const totalUSDCAmountAfter = await USDC.balanceOf(user1.address);
      console.log('expected fee amounts: ', feeAmount, "(10 USDC)");
      console.log("Received fee amounts: ", totalFeeAmountAfter - totalFeeAmountBefore);
      console.log("fee amounts is different than expected amount due to changed amount after converted DAI to USDC");

      console.log('expected USDC amounts that user can receive: ', 1990e6, "(2000 USDC)");
      console.log("                      Received USDC amounts: ", totalUSDCAmountAfter - totalUSDCAmountBefore);
      console.log("USDC amounts is different than expected amount due to changed amount after converted DAI to USDC");
    });

    it("Withdraw 100 USDC from Water", async function () {
      // Can't withdraw due to lend many token to leverage vault so revert right now
      await expect(Water.connect(user1).withdrawStableCoin(USDC.address, 100e6, user1.address, user1.address))
        .to.be.revertedWith("NotEnoughAmount");
    });

    it("Withdraw 100 USDC from Whiskey at the first 48 hours of the epoch Wait until the end of the epoch and claim", async function () {
      // Increase gDAI price by manually proceeding to deposit other users
      console.log('Current gDAI price  : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
      // Distribute rewards as 2000000 DAI to Gains network for increase gDAI price
      const depositAmount = hre.ethers.utils.parseEther("1000000");
      await DAI.connect(DAI_Whale).approve(gDAI.address, depositAmount);
      await gDAI.connect(DAI_Whale).distributeReward(depositAmount);
      console.log('Increased gDAI price: ', convertFromWei(await Whiskey.gTokenPrice()), '$');

      // Go ahead count down period for active of withdraw feature
      console.log('Go ahead count down period: ', countDownPeriod, "seconds");
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      console.log('Increasing by 3 epochs...');
      // Increase time and go to next epoch
      await startNewEpoch();
      await startNewEpoch();
      await startNewEpoch();
      console.log('Epoch ID after increased time: ', (await Whiskey.currentEpoch()).toString());
      console.log('Utilization Rate percent before withdraw 100 USDC: ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Reward Split percent before withdraw 100 USDC: ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('Water price before withdrawing: ', convertFromWei(await Water.priceOfWater()), '$');
      // Save DAI balance of Water
      daiBalanceOfWater = await DAI.balanceOf(Water.address);
      const daiBalanceOfWaterNow = await DAI.balanceOf(Water.address);
      const usdcAmount = await USDC.balanceOf(user3.address);
      await Whiskey.connect(user3).withdrawStableCoin(USDC.address, 100e6);
      console.log('After withdraw 100 USDC (33.33 user deposited amount and 66.66 lend amount from LendingVault)');
      console.log('Fee 0.5 USDC and Actual withdraw 99.5 USDC');
      // console.log('Rewards amount user received (USDC): ', convertFromWei((await USDC.balanceOf(user3.address) - usdcAmount) - 33.33, 6));
      // console.log('Rewards amount Water contract received (DAI): ', convertFromWei((await DAI.balanceOf(Water.address) - daiBalanceOfWaterNow)), 'DAI');
      console.log('Water price after withdrawing: ', convertFromWei(await Water.priceOfWater(), 18, 8), '$');
    });

    it("All USDC (deposited 4000 USDC + lend 8000 USDC) withdraw", async function () {
      console.log('Utilization Rate percent before withdraw 12000 (Deposit 4000 + lend 8000) USDC: ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Reward Split percent before withdraw 12000 (Deposit 4000 + lend 8000) USDC: ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('Water price before withdrawing: ', convertFromWei(await Water.priceOfWater(), 18, 8), '$');
      const userInfo = await Whiskey.vaultInfoOf(user3.address, USDC.address);
      await Whiskey.connect(user3).redeemStableCoin(USDC.address, userInfo.shares.sub(userInfo.withdrawed));

      // console.log('User\'s USDC amount before deposit: ',convertFromWei(transferAmount, 6), 'USDC');
      // console.log('User\'s USDC amount after 4000 USDC withdraw: ', convertFromWei(await USDC.balanceOf(user3.address), 6), 'USDC');
      // console.log('Rewards amount user received: ', convertFromWei((await USDC.balanceOf(user3.address)).sub(transferAmount), 6), 'USDC');

      // const daiBalanceOfWaterNow = await DAI.balanceOf(Water.address);
      // console.log('DAI amount borrowed when user deposit 4000 USDC: ', convertFromWei(lendAmount), 'DAI');
      // console.log('DAI amount received after withdraw 4000 USDC:    ', convertFromWei(daiBalanceOfWaterNow.sub(daiBalanceOfWater)), 'DAI');
      // console.log('Rewards amount of water: ', convertFromWei(daiBalanceOfWaterNow.sub(daiBalanceOfWater).sub(lendAmount)), 'DAI');
      console.log('Water price after withdrawing: ', convertFromWei(await Water.priceOfWater(), 18, 5), '$');
    });
  });
});
