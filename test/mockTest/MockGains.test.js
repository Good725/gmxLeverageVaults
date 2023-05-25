const { expect } = require("chai");
const hre = require("hardhat");
const {
  USDT_address,
  FRAX_address,
  DAI_address,
  UniswapV2Router2_address,
  DAI_whale_address,
} = require("../data");
const { MockGains, startNewEpoch, updateGDaiPrice } = require("../MockGains");
const { convertFromWei } = require("../utils");

describe("Whiskey test case with Mock gDai", function () {
  let Whiskey;
  let Water;
  let DAI;
  let gDAI;
  let GainsManager;
  let ceo;
  let manager;
  let admin;
  let feeReceiver;
  let WhiskeyUserA;
  let WhiskeyUserB;
  let WhiskeyUserC;
  let WhiskeyUserD;
  let WaterUserA;
  let WaterUserB;

  let countDownPeriod;

  const depositAmount = hre.ethers.utils.parseEther("10000");

  before(async function () {
    [ceo, manager, admin, feeReceiver, WhiskeyUserA, WhiskeyUserB, WhiskeyUserC, WhiskeyUserD, WaterUserA, WaterUserB] = await hre.ethers.getSigners();

    // DAI token
    const dai_whale = DAI_whale_address;
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [dai_whale],
    });
    const DAI_Whale = await hre.ethers.getSigner(dai_whale);
    DAI = await hre.ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      DAI_address,
      DAI_Whale
    );
    // fund the whale's wallet with gas
    await ceo.sendTransaction({
      to: dai_whale,
      value: hre.ethers.utils.parseEther("10"),
    });

    // Transfer DAI to users
    const transferAmount = hre.ethers.utils.parseUnits("20000");
    await DAI.transfer(WhiskeyUserA.address, transferAmount);
    await DAI.transfer(WhiskeyUserB.address, transferAmount);
    await DAI.transfer(WhiskeyUserC.address, transferAmount);
    await DAI.transfer(WhiskeyUserD.address, transferAmount);
    await DAI.transfer(WaterUserA.address, transferAmount);
    await DAI.transfer(WaterUserB.address, transferAmount);

    // Mock gDAI contract
    gDAI = await MockGains(ceo.address, manager.address, admin.address);
    await DAI.transfer(gDAI.address, transferAmount);

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
      [DAI_address, USDT_address, FRAX_address]
    );

    // LeverageVault contract deploy
    const whiskeyContract = await hre.ethers.getContractFactory(
      "contracts/LeverageVault.sol:LeverageVault"
    );
    Whiskey = await whiskeyContract.deploy(
      DAI_address,
      UniswapV2Router2_address,
      gDAI.address,
      Water.address,
      feeReceiver.address,
      admin.address,
      [DAI_address, USDT_address, FRAX_address]
    );

    await Water.connect(ceo).changeLeverageVault(Whiskey.address);
  });

  describe("Day 0", function () {
    it("Start new epoch for correct test", async function () {
      await startNewEpoch(gDAI);
    });

    it("Initial set before leverage", async function () {
      // set Fee percent 0%
      await Whiskey.connect(ceo).changeProtocolFee(feeReceiver.address, 0);
      await Water.connect(ceo).changeProtocolFee(feeReceiver.address, 0);

      console.log('VLP Price(gDai price) on the purchase day : ', convertFromWei(await Whiskey.gTokenPrice()), '$');

      console.log('Water User A deposits 10000 DAI to Water Vault');
      console.log('Water User B deposits 0 DAI to Water Vault');
      await DAI.connect(WaterUserA).approve(Water.address, depositAmount);
      await Water.connect(WaterUserA).depositStableCoin(DAI_address, depositAmount, WaterUserA.address);

      console.log('Whiskey User A deposits 500 DAI to Leverage (Whiskey) Vault');
      console.log('Whiskey User B deposits 500 DAI to Leverage (Whiskey) Vault');
      console.log('Whiskey User C deposits 0 DAI to Leverage (Whiskey) Vault');
      console.log('Whiskey User D deposits 0 DAI to Leverage (Whiskey) Vault');
      const leverageDepositAmount = hre.ethers.utils.parseEther("500");
      await DAI.connect(WhiskeyUserA).approve(Whiskey.address, leverageDepositAmount);
      await Whiskey.connect(WhiskeyUserA).deposit(DAI_address, leverageDepositAmount, 200);
      await DAI.connect(WhiskeyUserB).approve(Whiskey.address, leverageDepositAmount);
      await Whiskey.connect(WhiskeyUserB).deposit(DAI_address, leverageDepositAmount, 200);

      console.log('Leverage Size is : 3X (2x lend from Water)');
      console.log('Liquidation Threshold is : ', convertFromWei(await Whiskey.MAX_DTV(), 2, 2), '%');

      console.log('Fee Split Slope 1 is : ', convertFromWei(await Water.MAX_FEE_SPLIT1_VALUE(), 2, 2), '%');
      console.log('Fee Split Slope 2 is : ', convertFromWei(await Water.MAX_FEE_SPLIT2_VALUE(), 2, 2), '%');
      console.log('Fee Split Slope 3 is : ', convertFromWei(await Water.MAX_FEE_SPLIT3_VALUE(), 2, 2), '%');

      console.log('UR Slope 1 is : ', convertFromWei(await Water.MAX_FEE_SPLIT1(), 2, 2), '%');
      console.log('UR Slope 2 is : ', convertFromWei(await Water.MAX_FEE_SPLIT2(), 2, 2), '%');
      console.log('UR Slope 3 is : ', convertFromWei(await Water.MAX_FEE_SPLIT3(), 2, 2), '%');

      console.log('Whiskey Deposit Fees is : 0%');
      console.log('Whiskey Withdrawal Fees is : 0%');
      console.log('Water Deposit Fees is : 0%');
      console.log('Water Withdrawal Fees is : 0%');
    });

    it("Day 0 after leverage", async function () {
      console.log('Water initial deposited 10000 DAI');
      console.log('Whiskey initial deposited 1000 DAI (userA 500, userB 500)');
      console.log('Current DAI balance of Water is : 8000 DAI (Lent 2000 DAI to Leverage)');
      console.log('Whiskey initial balance is : 3000 DAI (user deposit 500 + lent 1000) * 2');
      console.log('Amount of VLP(gDAI) is : 3000 gDAI');
      console.log('Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Reward fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('Initial Asset Value is : 3000 DAI');
      console.log('Initial Debt Value is : ', convertFromWei(await Water.totalDebt()), 'DAI');
      console.log('DTV Ratio is : ', convertFromWei(1000 / 1500, 0, 2), 'DAI');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address, DAI_address)), "DAI");
      console.log("(User deposit 500 + Lend 1000 DAI = 1500 DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address, DAI_address)), "DAI");
    });
  });

  describe("Base Case 1 - VLP Price Changes", function () {
    it("Day 1", async function () {
      // Set gDAI price is : 1.1$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.1"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');

      console.log('Total deposited DAI by user to Whiskey : ', 1000, "DAI");
      console.log('Current DAI balance of Water : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('total rewards (userA + userB) is : ', 3000 * 0.1);

      const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
      console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * 1.1).toFixed(2), 'DAI');

      console.log('Expect Utilization Rate is ', (Number(convertFromWei(await Water.totalDebt())) + 30) / 10000 * 100, '%');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address, DAI_address)), "DAI");
      console.log("(User deposit 500 + Lend 1000 DAI = 1500 DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address, DAI_address)), "DAI");

      console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
      console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
      console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
    });

    it("Day 2", async function () {
      // Set gDAI price is : 1$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');
      console.log('Total deposited DAI by user to Whiskey (userA 500 + userB 500): ', 1000, "DAI");
      console.log('Current DAI balance of Water : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('total rewards (userA + userB) is : ', 3000 * (-0.1));
      const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
      console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * 1).toFixed(2), 'DAI');

      console.log('Expect Utilization Rate is ', (Number(convertFromWei(await Water.totalDebt())) + 30) / 10000 * 100, '%');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address, DAI_address)), "DAI");
      console.log("(User deposit 500 + Lend 1000 DAI = 1500 DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address, DAI_address)), "DAI");

      console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
      console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
      console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
    });
  });

  describe("Base Case 2 - Deposit to Whiskey", function () {
    it("Day 1", async function () {
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Current gDAI price is : ', gDAIPrice, '$');

      console.log('Whiskey User A new deposit 100 DAI');
      const leverageDepositAmount = hre.ethers.utils.parseEther("100");
      await DAI.connect(WhiskeyUserA).approve(Whiskey.address, leverageDepositAmount);
      await Whiskey.connect(WhiskeyUserA).deposit(DAI_address, leverageDepositAmount, 200);
      console.log('Whiskey User C new deposit 100 DAI');
      await DAI.connect(WhiskeyUserC).approve(Whiskey.address, leverageDepositAmount);
      await Whiskey.connect(WhiskeyUserC).deposit(DAI_address, leverageDepositAmount, 200);
      console.log('Success deposited');

      console.log('Total whiskey deposited by user ', 500+500+100+100, 'DAI');
      console.log('Water balance (after lend 2000 + 400) is ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('Total whiskey deposited (user + lend) ', (1500+300)*2, 'DAI');
      console.log('Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Reward fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('DTV Ratio is : ', convertFromWei(1400 / 3600, 0, 2), 'DAI');

      console.log('Max amount gDAI user A can withdraw (500+100)*3: ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user B can withdraw (500*3) : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user C can withdraw (100*3): ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user D can withdraw (0): ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address, DAI_address)), "DAI");

      console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
    });

    it("Day 2", async function () {
      console.log('New deposited 0');

      console.log('Total whiskey deposited by user ', 500+500+100+100, 'DAI');
      console.log('Water balance (after lend 2000 + 400) is ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('Total whiskey deposited (user + lend) ', (1500+300)*2, 'DAI');
      console.log('Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Reward fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('DTV Ratio is : ', convertFromWei(1400 / 3600, 0, 2), 'DAI');

      console.log('Max amount gDAI user A can withdraw (500+100)*3: ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user B can withdraw (500*3) : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user C can withdraw (100*3): ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address, DAI_address)), "DAI");
      console.log('Max amount gDAI user D can withdraw (0): ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address, DAI_address)), "DAI");

      console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
    });
  });

  describe("Base Case 3 - Withdraw from Whiskey", function () {
    it("Day 1", async function () {
      console.log('Whiskey user A new withdrawal : 100 DAI');
      console.log('Whiskey user A new withdrawal : 0 DAI');
      console.log('Whiskey user A new withdrawal : 0 DAI');
      console.log('Whiskey user A new withdrawal : 0 DAI');

      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.1"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');

      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      await startNewEpoch(gDAI);
      const withdrawAmount = hre.ethers.utils.parseEther("300");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(DAI_address, withdrawAmount);

      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalance = await Water.balanceOfDAI();
      console.log('Water balance before withdraw', convertFromWei(waterBalance));
      console.log('Whiskey user A balance before withdraw', convertFromWei(userABalance));
      await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmount);
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);

      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Water balance after withdraw', convertFromWei(waterBalanceAfter));

      console.log('Whiskey user A balance after withdraw:', convertFromWei(userABalanceAfter), 'DAI');
      console.log('Rewards to user: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 100, "DAI");
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 200, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });

    it("Day 2", async function () {
      console.log('Whiskey user A new withdrawal : 100 DAI');
      console.log('Whiskey user B new withdrawal : 200 DAI');
      console.log('Whiskey user A new withdrawal : 0 DAI');
      console.log('Whiskey user A new withdrawal : 0 DAI');

      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      await startNewEpoch(gDAI);
      const withdrawAmountA = hre.ethers.utils.parseEther("300");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(DAI_address, withdrawAmountA);
      const withdrawAmountB = hre.ethers.utils.parseEther("600");
      await Whiskey.connect(WhiskeyUserB).makeWithdrawRequest(DAI_address, withdrawAmountB);

      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalance = await Water.balanceOfDAI();
      console.log('Water balance before withdraw', convertFromWei(waterBalance), 'DAI');
      console.log('Whiskey user A balance before withdraw', convertFromWei(userABalance), 'DAI');

      await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmountA);
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 200, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');

      console.log('Water balance after user A withdraw', convertFromWei(waterBalanceAfter), 'DAI');
      console.log('Whiskey user A balance after user A withdraw', convertFromWei(userABalanceAfter), 'DAI');


      const userABalanceB = await DAI.balanceOf(WhiskeyUserB.address);
      const waterBalanceB = await Water.balanceOfDAI();
      console.log('Water balance before user B withdraw', convertFromWei(waterBalanceB), 'DAI');
      console.log('Whiskey user A balance user B before withdraw', convertFromWei(userABalanceB), 'DAI');

      await Whiskey.connect(WhiskeyUserB).redeem(withdrawAmountB);
      const userABalanceBAfter = await DAI.balanceOf(WhiskeyUserB.address);
      const waterBalanceAfterB = await Water.balanceOfDAI();
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfterB.sub(waterBalanceB)) - 400, "DAI");

      console.log('Water balance before user B withdraw', convertFromWei(waterBalanceAfterB), 'DAI');
      console.log('Whiskey user A balance user B before withdraw', convertFromWei(userABalanceBAfter), 'DAI');

      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Rewards to user A: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 100, "DAI");
      console.log('Rewards to user B: ', convertFromWei(userABalanceBAfter.sub(userABalanceB)) - 200, "DAI");
      console.log('Current gDAI price is : ', gDAIPrice, '$');
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });
  });
});
