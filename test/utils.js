const BigNumber = require("bignumber.js");

const convertFromWei = (val, decimals = 18, fixed = 3) => {
  const result = new BigNumber(val.toString()).dividedBy(10 ** decimals).toFixed(fixed);
  return Number(result);
};

module.exports = {
  convertFromWei,
};
