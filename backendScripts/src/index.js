const Web3 = require("web3");
const cron = require("node-cron");
const Provider = require('@truffle/hdwallet-provider');
var app = express();

require("dotenv").config();

const { LeverageVaultAbi } = require("./abis");
const { leverageVaultAddress } = require("./utils/constant");

const port = process.env.PORT || "8001";
const private_key = process.env.PRIVATE_KEY;
// Using Infura WebSockets
const infura_provider = process.env.INFURA_PROVIDER;

const provider = new Provider(private_key, infura_provider);
const web3 = new Web3(provider);
const leverageVaultContract = new web3.eth.Contract(LeverageVaultAbi, leverageVaultAddress);

const withdrawPendingRequest = async () => {
  try {
    const pendingWithdrawRequests = await leverageVaultContract.methods.hasPendingRequestNow().call();

    if (pendingWithdrawRequests) {
      await leverageVaultContract.methods.makeWithdrawRequestOfPending().send();
    }
  } catch (error) {
    console.log('error', error);
  }
}

// At minute 0 past every 8th hour.
cron.schedule("0 */8 * * *", async () => {
  await withdrawPendingRequest();
});

app.listen(port, async () => {
  console.log(`Server listening on ${port}`);
});
