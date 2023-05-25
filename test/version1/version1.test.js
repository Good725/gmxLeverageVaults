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
    console.log('Liquidation Threshold is : ', convertFromWei(await Whiskey.MAX_DTV(), 2, 3), '%');

    console.log('Fee Split Slope 1 is : ', convertFromWei(await Water.MAX_FEE_SPLIT1_VALUE(), 2, 3), '%');
    console.log('Fee Split Slope 2 is : ', convertFromWei(await Water.MAX_FEE_SPLIT2_VALUE(), 2, 3), '%');
    console.log('Fee Split Slope 3 is : ', convertFromWei(await Water.MAX_FEE_SPLIT3_VALUE(), 2, 3), '%');

    console.log('UR Slope 1 is : ', convertFromWei(await Water.MAX_FEE_SPLIT1(), 2, 3), '%');
    console.log('UR Slope 2 is : ', convertFromWei(await Water.MAX_FEE_SPLIT2(), 2, 3), '%');
    console.log('UR Slope 3 is : ', convertFromWei(await Water.MAX_FEE_SPLIT3(), 2, 3), '%');

    console.log('Whiskey Deposit Fees is : 0%');
    console.log('Whiskey Withdrawal Fees is : 0%');
    console.log('Water Deposit Fees is : 0%');
    console.log('Water Withdrawal Fees is : 0%');

    console.log('Water initial deposited 10000 DAI');
    console.log('Whiskey initial deposited 1000 DAI (userA 200, userB 200, userC 300, userD 300 DAI)');
    console.log('Current DAI balance of Water is :', convertFromWei(await Water.balanceOfDAI()), 'DAI (Lent 2000 DAI to Leverage)');
    console.log('Whiskey initial balance is : 3000 DAI (user deposit 500 + lent 1000) * 2');
    console.log('Amount of VLP(gDAI) is :', convertFromWei(await Whiskey.totalShares()), 'gDAI');
    console.log('Utilization Rate is : ', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
    console.log('Current Reward fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
    console.log('Initial Debt Value is : ', convertFromWei(await Water.totalDebt()), 'DAI');
    console.log('DTV Ratio is : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');

    console.log('Max amount gDAI user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address)), "DAI");
    console.log('Max amount gDAI user B can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address)), "DAI");
    console.log('Max amount gDAI user C can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address)), "DAI");
    console.log('Max amount gDAI user D can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address)), "DAI");
    console.log('Max amount Water user A can withdraw : ', convertFromWei(await Water.balanceOf(WaterUserA.address)));
    console.log('Max amount Water user B can withdraw : ', convertFromWei(await Water.balanceOf(WaterUserB.address)));

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

      console.log('Whiskey balance : ', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));

      console.log('Amount of VLP', convertFromWei(await Whiskey.totalShares()));

      console.log('Utilization Rate', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
      console.log('total rewards : ', 3000 * 0.1);
      console.log('Reward split to water : ', convertFromWei(await Whiskey.totalDebt()), 'DAI');
      console.log('Asset Value : ', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));
      const debtValue = convertFromWei(await Whiskey.totalDebtToLend());
      console.log('Debt value : ', debtValue, 'DAI');
      console.log('DTV ratio : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');
      const totalDepositAmounts = convertFromWei(await Whiskey.totalDepositAmount());
      const userABalance = convertFromWei((await Whiskey.userInfo(WhiskeyUserA.address)).depositAmount);
      const userBBalance = convertFromWei((await Whiskey.userInfo(WhiskeyUserB.address)).depositAmount);
      const userCBalance = convertFromWei((await Whiskey.userInfo(WhiskeyUserC.address)).depositAmount);
      const userDBalance = convertFromWei((await Whiskey.userInfo(WhiskeyUserD.address)).depositAmount);
      console.log('Whiskey user A shares : ', userABalance * 100 / totalDepositAmounts, '%');
      console.log('Whiskey user B shares : ', userBBalance * 100 / totalDepositAmounts, '%');
      console.log('Whiskey user C shares : ', userCBalance * 100 / totalDepositAmounts, '%');
      console.log('Whiskey user D shares : ', userDBalance * 100 / totalDepositAmounts, '%');

      console.log('Max amount gDAI Whiskey user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address)), "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address)), "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address)), "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address)), "DAI");
      const totalShares = convertFromWei(await Water.totalSupply());
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserA.address)) / totalShares * 100, '%');
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserB.address)) / totalShares * 100, '%');
      const waterPrice = convertFromWei(await Water.priceOfWater(), 18, 6);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);
      console.log('Max amount Water user A can withdraw ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Max amount Water user B can withdraw ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);

      console.log('Water supply', 10000, 'DAI');
      console.log('Water price', waterPrice, '$');
      console.log('Leverage size : ', 100 / (100 - convertFromWei(await Whiskey.totalDTV(), 2, 3)));
    });

    it("Day 2: When Whiskey userA withdraw 100 DAI", async function () {
      console.log('');
      await startNewEpoch(gDAI);

      const withdrawAmount = hre.ethers.utils.parseEther("100");
      await Whiskey.connect(WhiskeyUserA).makeWithdrawRequestWithAssets(withdrawAmount);

      console.log('');
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);
      await startNewEpoch(gDAI);

      await Whiskey.connect(WhiskeyUserA).withdraw(withdrawAmount);
      // console.log('Whiskey Deposits', convertFromWei(await Whiskey.totalDepositAmount()), 'DAI');
      console.log('Whiskey Deposits', 900, 'DAI');
      console.log('Water balance', convertFromWei(await Water.balanceOfDAI()));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Whiskey balance', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));
      console.log('Amount of VLP', convertFromWei(await Whiskey.totalShares()));

      console.log('Utilization Rate', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
      console.log('total rewards (userA + userB + userC + userD) is : ', 0);
      console.log('Reward split to water : ', 0);
      const assetValue = (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3);
      console.log('Asset Value : ', assetValue);
      const debtValue = convertFromWei(await Whiskey.totalDebtToLend());
      console.log('Debt value : ', debtValue, 'DAI');
      console.log('DTV ratio : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');
      const totalWithdrawAmount = assetValue - debtValue;
      const userABalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address));
      const userBBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address));
      const userCBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address));
      const userDBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address));

      console.log('Whiskey user A shares : ', userABalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user B shares : ', userBBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user C shares : ', userCBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user D shares : ', userDBalance * 100 / totalWithdrawAmount, '%');

      console.log('Max amount gDAI Whiskey user A can withdraw : ', userABalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userBBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userCBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userDBalance, "DAI");
      const totalShares = convertFromWei(await Water.totalSupply());
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserA.address)) / totalShares * 100, '%');
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserB.address)) / totalShares * 100, '%');
      const waterPrice = convertFromWei(await Water.priceOfWater(), 18, 6);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);
      console.log('Max amount Water user A can withdraw ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Max amount Water user B can withdraw ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);

      console.log('Water supply', 10000, 'DAI');
      console.log('Water price', waterPrice, '$');
      console.log('Leverage size : ', 100 / (100 - convertFromWei(await Whiskey.totalDTV(), 2, 3)));
    });

    it("Day 3: When Whiskey userB deposit 200 DAI", async function () {
      console.log('');
      await startNewEpoch(gDAI);

      const leverageDepositAmount = hre.ethers.utils.parseEther("200");
      await DAI.connect(WhiskeyUserB).approve(Whiskey.address, leverageDepositAmount);
      await Whiskey.connect(WhiskeyUserB).deposit(leverageDepositAmount);

      console.log('Whiskey Deposits', 1100, 'DAI');
      console.log('Water balance', convertFromWei(await Water.balanceOfDAI()));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Whiskey balance', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));
      console.log('Amount of VLP', convertFromWei(await Whiskey.totalShares()));

      console.log('Utilization Rate', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
      console.log('total rewards: ', 0);
      console.log('Reward split to water : ', 0);
      const assetValue = (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3);
      console.log('Asset Value : ', assetValue);
      const debtValue = convertFromWei(await Whiskey.totalDebtToLend());
      console.log('Debt value : ', debtValue, 'DAI');
      console.log('DTV ratio : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');
      const totalWithdrawAmount = assetValue - debtValue;
      const userABalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address));
      const userBBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address));
      const userCBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address));
      const userDBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address));

      console.log('Whiskey user A shares : ', userABalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user B shares : ', userBBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user C shares : ', userCBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user D shares : ', userDBalance * 100 / totalWithdrawAmount, '%');

      console.log('Max amount gDAI Whiskey user A can withdraw : ', userABalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userBBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userCBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userDBalance, "DAI");
      const totalShares = convertFromWei(await Water.totalSupply());
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserA.address)) / totalShares * 100, '%');
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserB.address)) / totalShares * 100, '%');
      const waterPrice = convertFromWei(await Water.priceOfWater(), 18, 6);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);
      console.log('Max amount Water user A can withdraw ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Max amount Water user B can withdraw ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);

      console.log('Water supply', 10000, 'DAI');
      console.log('Water price', waterPrice, '$');
      console.log('Leverage size : ', 100 / (100 - convertFromWei(await Whiskey.totalDTV(), 2, 3)));
    });

    it("Day 4: VLP price changes to 0.9$", async function () {
      console.log('');
      // Set gDAI price is : 0.9$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("0.9"));

      console.log('Whiskey Deposits', 1100, 'DAI');
      console.log('Water balance', convertFromWei(await Water.balanceOfDAI()));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Whiskey balance', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));
      console.log('Amount of VLP', convertFromWei(await Whiskey.totalShares()));

      console.log('Utilization Rate', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
      console.log('total rewards is : ', convertFromWei(await Whiskey.totalDepositAmount()) * 3 * (0.9 - 1.1));
      console.log('Reward split to water : ', 0);
      const assetValue = (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3);
      console.log('Asset Value : ', assetValue);
      const debtValue = convertFromWei(await Whiskey.totalDebtToLend());
      console.log('Debt value : ', debtValue, 'DAI');
      console.log('DTV ratio : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');
      const totalWithdrawAmount = assetValue - debtValue;
      const userABalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address));
      const userBBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address));
      const userCBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address));
      const userDBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address));

      console.log('Whiskey user A shares : ', userABalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user B shares : ', userBBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user C shares : ', userCBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user D shares : ', userDBalance * 100 / totalWithdrawAmount, '%');

      console.log('Max amount gDAI Whiskey user A can withdraw : ', userABalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userBBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userCBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userDBalance, "DAI");
      const totalShares = convertFromWei(await Water.totalSupply());
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserA.address)) / totalShares * 100, '%');
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserB.address)) / totalShares * 100, '%');
      const waterPrice = convertFromWei(await Water.priceOfWater(), 18, 6);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);
      console.log('Max amount Water user A can withdraw ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Max amount Water user B can withdraw ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);

      console.log('Water supply', 10000, 'DAI');
      console.log('Water price', waterPrice, '$');
      console.log('Leverage size : ', 100 / (100 - convertFromWei(await Whiskey.totalDTV(), 2, 3)));
    });

    it("Day 5: VLP price changes to 1.2$", async function () {
      console.log('');
      // Set gDAI price is : 1.2$
      await updateGDaiPrice(gDAI, hre.ethers.utils.parseEther("1.2"));
      await Whiskey.updateDTV();

      console.log('Whiskey Deposits', 1100, 'DAI');
      console.log('Water balance', convertFromWei(await Water.balanceOfDAI()));
      const gDAIPrice = convertFromWei(await Whiskey.gTokenPrice());
      console.log('Whiskey balance', (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3));
      console.log('Amount of VLP', convertFromWei(await Whiskey.totalShares()));

      console.log('Utilization Rate', convertFromWei(await Water.utilizationRate(), 2, 3), '%');
      console.log('Current Rewards fee split ratio is : ', convertFromWei(await Water.rewardSplit(), 2, 3), '%');
      console.log('total rewards is : ', convertFromWei(await Whiskey.totalDepositAmount()) * 3 * (1.2 - 0.9));
      console.log('Reward split to water : ', 0);
      const assetValue = (convertFromWei(await Whiskey.totalShares()) * gDAIPrice).toFixed(3);
      console.log('Asset Value : ', assetValue);
      const debtValue = convertFromWei(await Whiskey.totalDebtToLend());
      console.log('Debt value : ', debtValue, 'DAI');
      console.log('DTV ratio : ', convertFromWei(await Whiskey.totalDTV(), 2, 3), '%');
      const totalWithdrawAmount = assetValue - debtValue;
      const userABalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserA.address));
      const userBBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserB.address));
      const userCBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserC.address));
      const userDBalance = convertFromWei(await Whiskey.maxWithdrawAmountOf(WhiskeyUserD.address));

      console.log('Whiskey user A shares : ', userABalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user B shares : ', userBBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user C shares : ', userCBalance * 100 / totalWithdrawAmount, '%');
      console.log('Whiskey user D shares : ', userDBalance * 100 / totalWithdrawAmount, '%');

      console.log('Max amount gDAI Whiskey user A can withdraw : ', userABalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userBBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userCBalance, "DAI");
      console.log('Max amount gDAI Whiskey user A can withdraw : ', userDBalance, "DAI");
      const totalShares = convertFromWei(await Water.totalSupply());
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserA.address)) / totalShares * 100, '%');
      console.log('Water user A shares ', convertFromWei(await Water.balanceOf(WaterUserB.address)) / totalShares * 100, '%');
      const waterPrice = convertFromWei(await Water.priceOfWater(), 18, 6);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Water user A Balance ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);
      console.log('Max amount Water user A can withdraw ', convertFromWei(await Water.balanceOf(WaterUserA.address)) * waterPrice);
      console.log('Max amount Water user B can withdraw ', convertFromWei(await Water.balanceOf(WaterUserB.address)) * waterPrice);

      console.log('Water supply', 10000, 'DAI');
      console.log('Water price', waterPrice, '$');
      console.log('Leverage size : ', 100 / (100 - convertFromWei(await Whiskey.totalDTV(), 2, 3)));
    });
  });
});
