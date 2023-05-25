const { expect } = require("chai");
const hre = require("hardhat");
const {
  DAI_address,
  DAI_whale_address,
} = require("../data");
const { MockGains, startNewEpoch, updateGDaiPrice } = require("../MockGains");
const { convertFromWei } = require("../utils");

describe("Whiskey test case with Mock gDai", function () {
  let Whiskey;
  let Water;
  let DAI;
  let gDAI;
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

  const setDeployContracts = async () => {
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
    const transferAmount = hre.ethers.utils.parseUnits("10000");
    await DAI.transfer(WhiskeyUserA.address, transferAmount);
    await DAI.transfer(WhiskeyUserB.address, transferAmount);
    await DAI.transfer(WhiskeyUserC.address, transferAmount);
    await DAI.transfer(WhiskeyUserD.address, transferAmount);
    await DAI.transfer(WaterUserA.address, transferAmount);
    await DAI.transfer(WaterUserB.address, transferAmount);

    // Mock gDAI contract
    gDAI = await MockGains(ceo.address, manager.address, admin.address);
    await DAI.transfer(gDAI.address, transferAmount);
    // Set gDAI price is : 1$
    await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1"));

    // LeverageVault contract deploy
    const waterContract = await hre.ethers.getContractFactory(
      "contracts/LendingVaultV1.sol:LendingVaultV1"
    );
    Water = await waterContract.deploy(
      "Lending Vault",
      "Water",
      DAI_address,
      feeReceiver.address,
      admin.address,
    );

    // LeverageVault contract deploy
    const whiskeyContract = await hre.ethers.getContractFactory(
      "contracts/LeverageVaultV1.sol:LeverageVaultV1"
    );
    Whiskey = await whiskeyContract.deploy(
      DAI_address,
      gDAI.address,
      Water.address,
      feeReceiver.address,
      admin.address,
    );

    await Water.connect(ceo).changeLeverageVault(Whiskey.address);
  }

  const initialState = async () => {
    await startNewEpoch(gDAI);
    // set Fee percent 0%
    await Whiskey.connect(ceo).changeProtocolFee(feeReceiver.address, 0);
    await Water.connect(ceo).changeProtocolFee(feeReceiver.address, 0);

    console.log('VLP Price (gDai price) is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
    console.log('Water Price is ', convertFromWei(await Water.priceOfWater()));

    console.log('Water initial deposit 10000 (DAI)');
    console.log('Water User A deposits 5000 DAI to Water Vault');
    console.log('Water User B deposits 5000 DAI to Water Vault');
    let depositAmount = hre.ethers.utils.parseEther("5000");
    await DAI.connect(WaterUserA).approve(Water.address, depositAmount);
    await Water.connect(WaterUserA).deposit(depositAmount, WaterUserA.address);
    await DAI.connect(WaterUserB).approve(Water.address, depositAmount);
    await Water.connect(WaterUserB).deposit(depositAmount, WaterUserB.address);

    console.log('Whiskey Initial Deposit 1000 DAI');
    let leverageDepositAmount = hre.ethers.utils.parseEther("200");
    console.log('Whiskey User A deposits 200 DAI to Leverage (Whiskey) Vault');
    await DAI.connect(WhiskeyUserA).approve(Whiskey.address, leverageDepositAmount);
    await Whiskey.connect(WhiskeyUserA).deposit(leverageDepositAmount);
    console.log('Whiskey User B deposits 200 DAI to Leverage (Whiskey) Vault');
    await DAI.connect(WhiskeyUserB).approve(Whiskey.address, leverageDepositAmount);
    await Whiskey.connect(WhiskeyUserB).deposit(leverageDepositAmount);

    leverageDepositAmount = hre.ethers.utils.parseEther("300");
    console.log('Whiskey User C deposits 300 DAI to Leverage (Whiskey) Vault');
    await DAI.connect(WhiskeyUserC).approve(Whiskey.address, leverageDepositAmount);
    await Whiskey.connect(WhiskeyUserC).deposit(leverageDepositAmount);
    console.log('Whiskey User D deposits 300 DAI to Leverage (Whiskey) Vault');
    await DAI.connect(WhiskeyUserD).approve(Whiskey.address, leverageDepositAmount);
    await Whiskey.connect(WhiskeyUserD).deposit(leverageDepositAmount);

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

    console.log('Water initial deposited 10000 DAI');
    console.log('Whiskey initial deposited 1000 DAI (userA 200, userB 200, userC 300, userD 300 DAI)');
    console.log('Current DAI balance of Water is :', convertFromWei(await Water.balanceOfDAI()), 'DAI (Lent 2000 DAI to Leverage)');
    console.log('Whiskey initial balance is : 3000 DAI (user deposit 500 + lent 1000) * 2');
    console.log('Amount of VLP(gDAI) is :', convertFromWei(await Whiskey.totalShares()), 'gDAI');
    console.log('Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
    console.log('Current Reward fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
    console.log('Initial Debt Value is : ', convertFromWei(await Water.totalDebt()), 'DAI');
    const userInfoA = await Whiskey.userInfo(WhiskeyUserA.address);
    console.log('DTV Ratio is : ', convertFromWei(userInfoA.dtv, 2, 2), '%');

    console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address)), "DAI");
    console.log('Max amount gDAI user B can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address)), "DAI");
    console.log('Max amount gDAI user C can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address)), "DAI");
    console.log('Max amount gDAI user D can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address)), "DAI");
    console.log('Max amount Water user A can withdraw : ', convertFromWei(await Water.balanceOf(WaterUserA.address)));
    console.log('Max amount Water user B can withdraw : ', convertFromWei(await Water.balanceOf(WaterUserB.address)));

    console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
    console.log('gDAI total amount of whiskey is ', convertFromWei(await Whiskey.totalShares()));
    console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
  }

  const newInitialState = async () => {
    console.log('');
    console.log('');
    await setDeployContracts();
    await startNewEpoch(gDAI);
    await initialState();
  }

  describe("Case 1: Basic test", function () {
    it("Set initial state", async function () {
      await newInitialState();
    });

    it("Day 1: VLP price increased to $1.1", async function () {
      console.log('');
      // Set gDAI price is : 1.1$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.1"));
      await Whiskey.updateDTV();

      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP price : ', gDAIPrice, '$');

      console.log('Whiskey Deposits : ', 1000, "DAI");
      console.log('Water balance : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');

      const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
      console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * 1.1).toFixed(2), 'DAI');

      console.log('Amount of VLP is : ', 3000);

      console.log('Expect Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');
      console.log('total rewards (userA + userB + userC + userD) is : ', 3000 * 0.1);
      const rewards = await Whiskey.getTotalRewards();
      console.log('Reward split to water : ', convertFromWei(rewards[1]));
      console.log('Asset Value : ', (expectTotalAmount * 1.1).toFixed(2), 'DAI');
      console.log('Debt value : ', Number(convertFromWei(rewards[1])) + (2000), 'DAI');
      console.log('DTV ratio : ', convertFromWei(rewards[2], 2, 2), '%');
      const totalDepositAmounts = await Whiskey.totalDepositAmount();
      console.log('Whiskey user A shares : ', '20.00%');
      console.log('Whiskey user B shares : ', '20.00%');
      console.log('Whiskey user C shares : ', '30.00%');
      console.log('Whiskey user D shares : ', '30.00%');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address)), "DAI");

      console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
      console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
      const totalAmounts = (expectTotalAmount * 1.1).toFixed(2);
      console.log('totalAmounts', totalAmounts);
      console.log('convertFromWei(rewards[1])', convertFromWei(rewards[1]));
      console.log('Leverage size : ', totalAmounts / (totalAmounts - (Number(convertFromWei(rewards[1])) + (2000))));
    });

    it("Day 2: When Whiskey userA withdraw 100 DAI", async function () {
      console.log('');
      console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      console.log('Expect receive amount of user when 100 withdraw :', 100 + 26.25);
      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      console.log('Dai balance of user A before withdrawing :', convertFromWei(userABalance), 'DAI');
      const waterBalance = await Water.balanceOfDAI();
      console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');

      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      console.log('Make a withdraw request ...');
      const withdrawAmount = hre.ethers.utils.parseEther("300");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(withdrawAmount);

      console.log('Water price after make a withdraw request (not withdraw yet) is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
      console.log('gDAI price is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
      console.log('');
      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      console.log('Withdraw 300 gDAI (user 100 + lend 200)');
      console.log('Expect rewards amount is 30 DAI');
      await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmount);
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Dai balance of User A after withdraw:', convertFromWei(userABalanceAfter), 'DAI');
      console.log('Dai balance of Water after withdraw', convertFromWei(waterBalanceAfter), 'DAI');
      console.log('Rewards to user: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 100, "DAI");
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 200, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });

    it("Day 3: When Whiskey userB withdraw 200 DAI", async function () {
      console.log('');
      console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      const userBBalance = await DAI.balanceOf(WhiskeyUserB.address);
      console.log('Dai balance of user B before withdrawing :', convertFromWei(userBBalance), 'DAI');
      const waterBalance = await Water.balanceOfDAI();
      console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');

      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      console.log('Make a withdraw request ...');
      const withdrawAmount = hre.ethers.utils.parseEther("600");
      await Whiskey.connect(WhiskeyUserB).makeWithdrawRequest(withdrawAmount);

      console.log('Water price after make a withdraw request (not withdraw yet) is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
      console.log('gDAI price is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
      console.log('');
      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      console.log('Withdraw 600 gDAI (user 200 + lend 400)');
      console.log('Expect rewards amount is 60 DAI');
      await Whiskey.connect(WhiskeyUserB).redeem(withdrawAmount);
      const userBBalanceAfter = await DAI.balanceOf(WhiskeyUserB.address);
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Dai balance of User B after withdraw:', convertFromWei(userBBalanceAfter), 'DAI');
      console.log('Dai balance of Water after withdraw', convertFromWei(waterBalanceAfter), 'DAI');
      console.log('Rewards to user: ', convertFromWei(userBBalanceAfter.sub(userBBalance)) - 200, "DAI");
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 400, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });

    it("Day 4: VLP price increased to $1.2", async function () {
      console.log('');
      // Set gDAI price is : 1.2$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.2"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');

      console.log('Total deposited DAI by user to Whiskey : ', 700, "DAI");
      console.log('Current DAI balance of Water : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('total rewards (userA + userB + userC + userD) is : ', 2100 * 0.2);

      const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
      console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * 1.2).toFixed(2), 'DAI');

      console.log('Current Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address)), "DAI");
      console.log("(User deposit 100 + Lend 200 DAI = 300 DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address)), "DAI");

      console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
      console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });

    it("Day 5: When Whiskey userA withdraw 100 DAI", async function () {
      console.log('');
      console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      console.log('Dai balance of user A before withdrawing :', convertFromWei(userABalance), 'DAI');
      const waterBalance = await Water.balanceOfDAI();
      console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');

      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      console.log('Make a withdraw request ...');
      const withdrawAmount = hre.ethers.utils.parseEther("300");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(withdrawAmount);

      console.log('Water price after make a withdraw request (not withdraw yet) is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
      console.log('gDAI price is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
      console.log('');
      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      console.log('Withdraw 300 gDAI (user 100 + lend 200)');
      console.log('Expect rewards amount is 60 DAI');
      await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmount);
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Dai balance of User A after withdraw:', convertFromWei(userABalanceAfter), 'DAI');
      console.log('Dai balance of Water after withdraw', convertFromWei(waterBalanceAfter), 'DAI');
      console.log('Rewards to user: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 100, "DAI");
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 200, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });
  });

  describe("Case 2: Liquidation test", function () {
    it("Set initial state", async function () {
      await newInitialState();
    });

    it("Day 1: VLP price decreased to $0.75 (No Liquidation)", async function () {
      console.log('');
      // Set gDAI price is : 0.75$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("0.75"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');

      console.log('Total deposited DAI by user to Whiskey : ', 1000, "DAI");
      console.log('Current DAI balance of Water : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
      console.log('total rewards (userA + userB + userC + userD) is : ', 3000 * (0.75 - 1), 'DAI');

      const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
      console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * (0.75)).toFixed(2), 'DAI');

      console.log('Expect Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address)), "DAI");
      console.log("(User deposit 200 + Lend 400 DAI = 600 DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address)), "DAI");
      console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address)), "DAI");

      console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
      console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
      console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
    });

    it("Day 2: When Whiskey userA withdraw 49.75 DAI", async function () {
      console.log('');
      console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      console.log('Dai balance of user A before withdrawing :', convertFromWei(userABalance), 'DAI');
      const waterBalance = await Water.balanceOfDAI();
      console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');

      await startNewEpoch(gDAI);
      console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
      console.log('Make a withdraw request ...');
      const withdrawAmount = hre.ethers.utils.parseEther("149.25");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(withdrawAmount);

      console.log('Water price after make a withdraw request (not withdraw yet) is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
      console.log('gDAI price is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
      console.log('');
      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      console.log('Withdraw 149.25 gDAI (user 49.75 + lend 99.5)');
      console.log('Expect rewards amount is -37.3125 DAI');
      await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmount);
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Dai balance of User A after withdraw:', convertFromWei(userABalanceAfter), 'DAI');
      console.log('Dai balance of Water after withdraw', convertFromWei(waterBalanceAfter), 'DAI');
      console.log('Rewards to user: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 49.75, "DAI");
      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 99.5, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });

    it("Day 3: VLP price increased to $1", async function () {
      console.log('');
      // Set gDAI price is : 1$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');
    });

    it("Day 4: VLP price decreased to $0.5", async function () {
      console.log('');
      // Set gDAI price is : 0.75$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("0.75"));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');
    });

    it("Day 5: Liquidation", async function () {
      await startNewEpoch(gDAI);
      console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
      console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

      const liquidationUsers = await Whiskey.getLiquidationUsers();
      console.log('liquidationUsers', liquidationUsers);
      const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
      const userBBalance = await DAI.balanceOf(WhiskeyUserB.address);
      const userCBalance = await DAI.balanceOf(WhiskeyUserC.address);
      const userDBalance = await DAI.balanceOf(WhiskeyUserD.address);
      console.log('Dai balance of user A before liquidation :', convertFromWei(userABalance), 'DAI');
      console.log('Dai balance of user B before liquidation :', convertFromWei(userBBalance), 'DAI');
      console.log('Dai balance of user C before liquidation :', convertFromWei(userCBalance), 'DAI');
      console.log('Dai balance of user D before liquidation :', convertFromWei(userDBalance), 'DAI');
      const waterBalance = await Water.balanceOfDAI();
      console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');
      console.log('');
      console.log('Send Liquidation request');
      await Whiskey.connect(admin).liquidationRequest(liquidationUsers);

      console.log('Go to 3 epoch for withdraw');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      await Whiskey.connect(admin).liquidation();
      const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
      const userBBalanceAfter = await DAI.balanceOf(WhiskeyUserB.address);
      const userCBalanceAfter = await DAI.balanceOf(WhiskeyUserC.address);
      const userDBalanceAfter = await DAI.balanceOf(WhiskeyUserD.address);
      console.log('Dai balance of user A after liquidation :', convertFromWei(userABalanceAfter), 'DAI');
      console.log('Dai balance of user B after liquidation :', convertFromWei(userBBalanceAfter), 'DAI');
      console.log('Dai balance of user C after liquidation :', convertFromWei(userCBalanceAfter), 'DAI');
      console.log('Dai balance of user D after liquidation :', convertFromWei(userDBalanceAfter), 'DAI');
      const waterBalanceAfter = await Water.balanceOfDAI();
      console.log('Dai balance of Water after liquidation', convertFromWei(waterBalanceAfter), 'DAI');

      console.log('Rewards to user A: ', convertFromWei(userABalanceAfter.sub(userABalance)) - (200 - 49.75), "DAI");
      console.log('Rewards to user B: ', convertFromWei(userBBalanceAfter.sub(userBBalance)) - 200, "DAI");
      console.log('Rewards to user C: ', convertFromWei(userCBalanceAfter.sub(userCBalance)) - 300, "DAI");
      console.log('Rewards to user D: ', convertFromWei(userDBalanceAfter.sub(userDBalance)) - 300, "DAI");

      console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 1900.5, "DAI");
      console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
    });
  });

  // describe("Case 1: Basic test", function () {
  //   it("Set initial state", async function () {
  //     await newInitialState();
  //   });

  //   it("Day 1: VLP price increased to $1.1", async function () {
  //     console.log('');
  //     // Set gDAI price is : 1.1$
  //     await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.1"));
  //     const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
  //     console.log('New VLP(gDAI) price is : ', gDAIPrice, '$');

  //     console.log('Total deposited DAI by user to Whiskey : ', 1000, "DAI");
  //     console.log('Current DAI balance of Water : ', convertFromWei(await Water.balanceOfDAI()), 'DAI');
  //     console.log('total rewards (userA + userB + userC + userD) is : ', 3000 * 0.1);

  //     const expectTotalAmount = convertFromWei(await gDAI.balanceOf(Whiskey.address));
  //     console.log('Deposit amount + Rewards amount in Whiskey : ', (expectTotalAmount * 1.1).toFixed(2), 'DAI');

  //     console.log('Expect Utilization Rate is ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
  //     console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

  //     console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserA.address)), "DAI");
  //     console.log("(User deposit 200 + Lend 400 DAI = 600 DAI");
  //     console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserB.address)), "DAI");
  //     console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserC.address)), "DAI");
  //     console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.availableWithdrawRequestAmount(WhiskeyUserD.address)), "DAI");

  //     console.log('Water total supply is ', convertFromWei(await Water.totalSupply()));
  //     console.log('Max Total Deposited to gDai is ', convertFromWei(await gDAI.balanceOf(Whiskey.address)));
  //     console.log('Water price is ', convertFromWei(await Water.priceOfWater()), '$');
  //   });

  //   it("Day 2: When Whiskey userA withdraw 100 DAI", async function () {
  //     console.log('');
  //     console.log('Current Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 2), '%');
  //     console.log('Current Rewards split is : ', convertFromWei(await Water.rewardSplit(), 2, 2), '%');

  //     const userABalance = await DAI.balanceOf(WhiskeyUserA.address);
  //     console.log('Dai balance of user A before withdrawing :', convertFromWei(userABalance), 'DAI');
  //     const waterBalance = await Water.balanceOfDAI();
  //     console.log('Dai balance of Water vault before withdrawing :', convertFromWei(waterBalance), 'DAI');

  //     await startNewEpoch(gDAI);
  //     console.log('Epoch ID of current: ', (await Whiskey.currentEpoch()).toString());
  //     console.log('Make a withdraw request ...');
  //     const withdrawAmount = hre.ethers.utils.parseEther("300");
  //     await Whiskey.connect(WhiskeyUserA).makeWithdrawRequest(withdrawAmount);

  //     console.log('Water price after make a withdraw request (not withdraw yet) is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
  //     console.log('gDAI price is : ', convertFromWei(await Whiskey.gTokenPrice()), '$');
  //     console.log('');
  //     console.log('Go to 3 epoch for withdraw');
  //     await startNewEpoch(gDAI);
  //     await startNewEpoch(gDAI);
  //     await startNewEpoch(gDAI);

  //     console.log('Withdraw 300 gDAI (user 100 + lend 200)');
  //     console.log('Expect rewards amount is 30 DAI');
  //     await Whiskey.connect(WhiskeyUserA).redeem(withdrawAmount);
  //     const userABalanceAfter = await DAI.balanceOf(WhiskeyUserA.address);
  //     const waterBalanceAfter = await Water.balanceOfDAI();
  //     console.log('Dai balance of User A after withdraw:', convertFromWei(userABalanceAfter), 'DAI');
  //     console.log('Dai balance of Water after withdraw', convertFromWei(waterBalanceAfter), 'DAI');
  //     console.log('Rewards to user: ', convertFromWei(userABalanceAfter.sub(userABalance)) - 100, "DAI");
  //     console.log('Rewards to water: ', convertFromWei(waterBalanceAfter.sub(waterBalance)) - 200, "DAI");
  //     console.log('Water price is ', convertFromWei(await Water.priceOfWater(), 18, 6), '$');
  //   });
  // });
});
