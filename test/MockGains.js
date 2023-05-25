const hre = require("hardhat");
const { upgrades } = require("hardhat");

const getData = (ceo, manager, admin) => {
  return [
    "Gains Network DAI", // name
    "gDAI", // symbol
    [
      "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
      ceo,
      manager,
      admin,
      "0xe5417af564e4bfda1c483642db72007871397896",
      "0xdd42aa3920c1d5b5fd95055d852135416369bcc1",
      "0x82e59334da8c667797009bbe82473b55c7a6b311",
      "0x8d687276543b92819f2f2b5c3faad4ad27f4440c",
      ["0x631e885028E75fCbB34C06d8ecB8e20eA18f6632", "0x3c88e882"],
    ],
    1209600,
    hre.ethers.utils.parseEther("0.25"),
    hre.ethers.utils.parseEther("0.5"),
    [hre.ethers.utils.parseEther("10"), hre.ethers.utils.parseEther("20")],
    hre.ethers.utils.parseEther("2"),
    hre.ethers.utils.parseEther("5"),
    hre.ethers.utils.parseEther("0.05"),
    hre.ethers.utils.parseEther("5"),
    hre.ethers.utils.parseEther("150"),
  ];
};

const MockGains = async (ceo, manager, admin) => {
  const mockData = getData(ceo, manager, admin);
  const mockGains = await hre.ethers.getContractFactory("contracts/Mock/Gains/gDai.sol:GToken");
  const MockGains = await upgrades.deployProxy(mockGains, mockData);
  return MockGains;
};

const updateGDaiPrice = async (gDai, newPrice) => {
  await gDai.updateGDaiPrice(newPrice);
}

const startNewEpoch = async (gDai) => {
  await hre.ethers.provider.send("evm_increaseTime", [86400*3]);
  await hre.ethers.provider.send("evm_mine", []);
  await gDai.updateEpoch();
}

module.exports = {
  MockGains,
  updateGDaiPrice,
  startNewEpoch
};
