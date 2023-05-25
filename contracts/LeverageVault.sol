// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "./interfaces/IGainsVault.sol";
import "./interfaces/ILendingVault.sol";

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract LeverageVault is Ownable {
    using SafeERC20 for IERC20;

    struct VaultInfo {
        uint256 depositAmount; // Deposit amount (native token DAI)
        uint256 debt; // lend native token amount when depositing (DAI)
        uint256 shares; // gToken (gDAI) amount received from Gains network after deposit
        uint256 withdrawed; // withdrawed gToken (gDAI) amount
        uint256 entryPrice; // Entry gToken (gDAI) price when depositing
        uint256 dtv;
    }

    struct PendingWithdrawRequest {
        address owner;
        uint256 shares;
        uint256 timestamp;
    }

    bool public paused;

    address public admin;
    address private nativeToken; // DAI
    /// StableCoins convert to DAI using Uniswap
    /// Example: 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D (UniswapV2Router02 Ethereum mainnet)
    address private uniswapRouter;
    /// Gains Network gDAI vault contract
    /// Example: 0x91993f2101cc758D0dEB7279d41e880F7dEFe827 (Gains Vault V6.3 gDAI contract Polygon mainnet)
    address private gainsVault;
    address private lendingVault; // Lending Vault contract address
    address public protocolFee; // protocol fee receiver address
    address[] private supportCoins; // Support stableCoins: USDC, USDT, FRAX

    uint256 public protocolFeePc = 50; // 0.5%

    /// If within the first 48 hours of the epoch, users can send withdrawal request and withdraw
    uint256 public constant MAX_WITHIN_TIME = 2 days;
    uint256 public constant PRICE_SLIPPAGE = 200; // 2%: When gToken price changes >= +/- 2%
    uint256 public constant DENOMINATOR = 10000;
    uint256 public constant MAX_DTV = 9000; // 90%
    /// x gDAI strategy for depositor holders
    /// Minimum 0, Maximum 2x lend
    /// 200 - lend 2x amount of deposit token (DAI or after converted to DAI)
    uint256 public constant MAX_X_LEVEL = 200;

    mapping(address => mapping(address => VaultInfo)) private vaultInfo; // user address => token address => VaultInfo
    mapping(uint256 => uint256) public totalPendingRequests; // current epoch id => shares
    /// epoch id => pending withdraw requests
    mapping(uint256 => PendingWithdrawRequest[]) public pendingWithdrawRequests;
    /// owner => unlock epoch => shares amount sent withdrawal request
    mapping(address => mapping(uint256 => uint256)) public withdrawRequest;
    /// owner => unlock epoch => shares amount pending withdrawal request
    mapping(address => mapping(uint256 => uint256)) public pendingRequest;

    modifier isPaused() {
        if (paused) {
            revert Paused();
        }
        _;
    }

    modifier zeroAddress(address addr) {
        if (addr == address(0)) {
            revert ZeroAddress();
        }
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "caller is not the admin");
        _;
    }

    constructor(
        address _nativeToken,
        address _router,
        address _gains,
        address _lendingVault,
        address _protocolFee,
        address _admin,
        address[] memory _supportCoins
    ) {
        nativeToken = _nativeToken;
        uniswapRouter = _router;
        gainsVault = _gains;
        lendingVault = _lendingVault;
        protocolFee = _protocolFee;
        admin = _admin;
        supportCoins = _supportCoins;
    }

    /**
     * @notice Token Deposit
     * @dev Users can deposit with some supported stableCoins (currently support DAI, USDC, USDT, FRAX)
     * @param token Deposit token address
     * @param amount Deposit token amount
     * @param xLevel Leverage level
     */
    function deposit(address token, uint256 amount, uint256 xLevel) external isPaused {
        if (xLevel > MAX_X_LEVEL) {
            revert ExcessedMaximum(xLevel, MAX_X_LEVEL);
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 protocolFeeAmount = _chargeFee(token, amount);
        uint256 actualAmount = _swapTokensForToken(
            token,
            nativeToken,
            amount - protocolFeeAmount
        );

        // If xLevel is 200 (2x), should lend 2x DAI
        uint256 lendAmount = ILendingVault(lendingVault).lend(actualAmount, xLevel);
        // Actual deposit amount to Gains network
        uint256 xAmount = actualAmount + lendAmount;

        IERC20(nativeToken).safeApprove(gainsVault, xAmount);
        // Don't need to check maxDeposit. Doing it from deposit of gains network.
        uint256 shares = IGainsVault(gainsVault).deposit(
            xAmount,
            address(this)
        );

        (uint256 dtv, uint256 currentGTokenPrice) = _getDTV(
            vaultInfo[msg.sender][token],
            actualAmount,
            lendAmount
        );

        vaultInfo[msg.sender][token].depositAmount += actualAmount;
        vaultInfo[msg.sender][token].debt += lendAmount;
        vaultInfo[msg.sender][token].shares += shares;
        vaultInfo[msg.sender][token].dtv = dtv;
        vaultInfo[msg.sender][token].entryPrice = currentGTokenPrice;

        emit Deposit(
            msg.sender,
            token,
            amount,
            lendAmount,
            shares,
            block.timestamp
        );
    }

    /**
     * @notice Make a withdraw request with user wants amount
     * @param token Token address deposited by user
     * @param shares gDAI amount for Redeem
     */
    function makeWithdrawRequest(address token, uint256 shares) public {
        if (shares > availableWithdrawRequestAmount(msg.sender, token)) {
            revert MoreThanBalance();
        }
        _makeWithdrawRequest(token, shares);
    }

    /**
     * @notice Make a withdraw request with all deposited amount of the token
     * @param token Token address deposited by user
     */
    function makeWithdrawAllRequest(address token) public {
        uint256 shares = availableWithdrawRequestAmount(msg.sender, token);
        _makeWithdrawRequest(token, shares);
    }

    /// @notice Make a withdraw request with a batch of all pending requests in the current epoch.
    function makeWithdrawRequestOfPending() external {
        if (!isAvailableWithdrawOrRequest()) {
            revert EndOfEpoch();
        }

        uint256 currentEpochId = currentEpoch();
        uint256 totalPendingAmount = totalPendingRequests[currentEpochId];
        if (totalPendingAmount == 0) {
            revert NoPendingRequests();
        }

        // Make a withdraw request
        uint256 unlockEpoch = currentEpochId + withdrawEpochsTimelock();
        PendingWithdrawRequest[]
            memory _pendingWithdrawRequest = pendingWithdrawRequests[
                currentEpochId
            ];

        for (uint256 i = 0; i < _pendingWithdrawRequest.length; i++) {
            withdrawRequest[_pendingWithdrawRequest[i].owner][
                unlockEpoch
            ] += _pendingWithdrawRequest[i].shares;
            pendingRequest[_pendingWithdrawRequest[i].owner][
                currentEpochId
            ] -= _pendingWithdrawRequest[i].shares;
        }

        // emit WithdrawRequested event from Gains network
        IGainsVault(gainsVault).makeWithdrawRequest(
            totalPendingAmount,
            address(this)
        );

        totalPendingRequests[currentEpochId] = 0;
    }

    /**
     * @notice Token Withdraw
     * @dev Users can withdraw about the sent a withdraw request
     * @param shares gDAI amount the user wants to withdraw
     */
    function redeem(uint256 shares) external {
        uint256 assets = IGainsVault(gainsVault).redeem(
            shares,
            address(this),
            address(this)
        );
        _withdraw(nativeToken, assets, shares);
    }

    /**
     * @notice Token Withdraw
     * @dev Users can withdraw about the sent a withdraw request
     * @param token Deposit token address
     * @param shares gDAI amount the user wants to withdraw
     */
    function redeemStableCoin(address token, uint256 shares) external {
        uint256 assets = IGainsVault(gainsVault).redeem(
            shares,
            address(this),
            address(this)
        );
        _withdraw(token, assets, shares);
    }

    /**
     * @notice Token Withdraw
     * @dev Users can withdraw about the sent a withdraw request
     * @param assets Withdraw DAI amount
     */
    function withdraw(uint256 assets) external {
        uint256 shares = IGainsVault(gainsVault).withdraw(
            assets,
            address(this),
            address(this)
        );
        _withdraw(nativeToken, assets, shares);
    }

    /**
     * @notice Token Withdraw
     * @dev Users can withdraw about the sent a withdraw request
     * @param token Withdraw token address
     * @param assets Withdraw token amount
     */
    function withdrawStableCoin(address token, uint256 assets) external {
        uint256 _assets = assets;
        if (token != nativeToken) {
            _assets = getAmountsIn(nativeToken, token, _assets);
        }
        uint256 shares = IGainsVault(gainsVault).withdraw(
            _assets,
            address(this),
            address(this)
        );
        _withdraw(token, _assets, shares);
    }

    /**
     * @notice Make a withdraw request
     * @dev Make a withdraw request for any amount of unlocked gDAI.
     *      User must make a request to withdraw your assets during the first 48 hours of any epoch
     *      This can only be done during the withdraw window of an epoch.
     *      Gains network emits an event for:
     *      <emit WithdrawRequested(sender, owner, shares, currentEpoch, unlockEpoch);>
     * @param token Token address deposited by user
     * @param shares gDAI amount for Redeem
     */
    function _makeWithdrawRequest(address token, uint256 shares) private {
        if (vaultInfo[msg.sender][token].shares == 0) {
            revert NotDepositer();
        }
        uint256 currentEpochId = currentEpoch();
        if (isAvailableWithdrawOrRequest()) {
            // Make a withdraw request
            uint256 unlockEpoch = currentEpochId + withdrawEpochsTimelock();
            withdrawRequest[msg.sender][unlockEpoch] += shares;

            // emit WithdrawRequested event from Gains network
            IGainsVault(gainsVault).makeWithdrawRequest(shares, address(this));
        } else {
            uint256 nextEpochId = currentEpochId + 1;
            totalPendingRequests[nextEpochId] += shares;
            pendingRequest[msg.sender][nextEpochId] += shares;
            pendingWithdrawRequests[nextEpochId].push(
                PendingWithdrawRequest({
                    owner: msg.sender,
                    shares: shares,
                    timestamp: block.timestamp
                })
            );

            emit PendingWithdrawRequested(
                msg.sender,
                nextEpochId,
                shares,
                block.timestamp
            );
        }
    }

    function _chargeFee(
        address token,
        uint256 amount
    ) private returns (uint256) {
        uint256 feeAmount = (amount * protocolFeePc) / DENOMINATOR;
        IERC20(token).safeTransfer(protocolFee, feeAmount);
        return feeAmount;
    }

    /**
     * @notice Token Withdraw private function
     * @dev Users can withdraw about the sent a withdraw request
     * @param token Deposit token address
     * @param assets Withdraw DAI amount
     * @param shares gDAI amount the user wants to withdraw
     */
    function _withdraw(address token, uint256 assets, uint256 shares) private {
        if (!isAvailableWithdrawOrRequest()) {
            revert EndOfEpoch();
        }
        uint256 currentEpochId = currentEpoch();
        withdrawRequest[msg.sender][currentEpochId] -= shares;
        vaultInfo[msg.sender][token].withdrawed += shares;
        // Withdrawal the DAI, and transfer 0.5% of all the DAI into the protocol address as the protocol fee
        uint256 protocolFeeAmount = _chargeFee(nativeToken, assets);
        // Actual withdrawal amount excluding protocol fee
        uint256 actualAmount = assets - protocolFeeAmount;

        VaultInfo memory _vaultInfo = vaultInfo[msg.sender][token];
        // Deposit amount as a percentage of currently withdrawn gToken amount
        uint256 depositAmountForShares = ((_vaultInfo.depositAmount +
            _vaultInfo.debt) * shares) / _vaultInfo.shares;
        // Lent amount in depositAmountForShares
        uint256 lentAmount = (depositAmountForShares * _vaultInfo.debt) /
            (_vaultInfo.depositAmount + _vaultInfo.debt);
        uint256 debt = lentAmount;
        // Check if has rewards amount
        if (actualAmount > depositAmountForShares) {
            uint256 rewards = actualAmount - depositAmountForShares; // Rewards amount
            // Debt to be returned to the Lending Vault
            // : lent amount + rewards amount for the reward split
            // console.log("Rewards amount user received after withdraw (DAI): ",
            //     rewards * (10000 - ILendingVault(lendingVault).rewardSplit()) / DENOMINATOR, "(/1e18)");
            // console.log("Rewards amount Water Contract received after withdraw (DAI): ",
            //     rewards * ILendingVault(lendingVault).rewardSplit() / DENOMINATOR, "(/1e18)");
            debt += (rewards * ILendingVault(lendingVault).rewardSplit()) / DENOMINATOR;
        }

        ILendingVault(lendingVault).allocateDebt(lentAmount);
        // Return lent amount and rewards amount to Lending vault and Update UR in lending Vault
        IERC20(nativeToken).safeTransfer(lendingVault, debt);

        // Convert nativeToken to user deposited token
        uint256 tokenToUser = _swapTokensForToken(
            nativeToken,
            token,
            actualAmount - debt
        );
        // Transfer token to user
        IERC20(token).safeTransfer(msg.sender, tokenToUser);

        emit Withdraw(msg.sender, shares, token, tokenToUser, block.timestamp);
    }

    /**
     *  @notice Swap exact tokens for token using uniswap router2
     *  @dev Only swap token for token, not path
     *       Check input token is in supportCoins list
     *  @param inputToken Input token address
     *  @param outputToken Output token address
     *  @param amountIn Input token amount
     *  @return amountOut Output token amount after swap
     */
    function _swapTokensForToken(
        address inputToken,
        address outputToken,
        uint256 amountIn
    ) private returns (uint256) {
        if (inputToken != outputToken) {
            bool isSupportCoin = false;
            for (uint256 i = 0; i < supportCoins.length; i++) {
                if (
                    supportCoins[i] == inputToken ||
                    supportCoins[i] == outputToken
                ) {
                    isSupportCoin = true;
                    IERC20(inputToken).safeApprove(uniswapRouter, amountIn);
                    // Convert input token to DAI using Uniswap
                    address[] memory path = new address[](2);
                    path[0] = inputToken;
                    path[1] = outputToken;
                    uint256[] memory amounts = IUniswapV2Router01(uniswapRouter)
                        .swapExactTokensForTokens(
                            amountIn,
                            0,
                            path,
                            address(this),
                            type(uint256).max
                        );
                    return amounts[amounts.length - 1];
                }
            }
            if (!isSupportCoin) {
                revert UnSupportedCoin();
            }
        }
        return amountIn;
    }

    /**
     * @notice Get DTV value
     * @param depositAmount User deposited amount (DAI or after converted to DAI)
     * @param debt Lend amount
     * @return DTV DTV value (If return 6667, DTV is 66.67%)
     * @return CurrentGTokenPrice Current gToken's price
     */
    function _getDTV(
        VaultInfo memory userVaultInfo,
        uint256 depositAmount,
        uint256 debt
    ) private view returns (uint256, uint256) {
        uint256 currentGTokenPrice = gTokenPrice();
        uint256 totalDebt = debt + userVaultInfo.debt;
        uint256 quantity = depositAmount +
            userVaultInfo.depositAmount +
            totalDebt;
        // Price movement (When gToken price changes >= +2%)
        uint256 rewards = 0;
        if (
            userVaultInfo.entryPrice > 0 &&
            currentGTokenPrice >=
            (userVaultInfo.entryPrice * (PRICE_SLIPPAGE + DENOMINATOR)) /
                DENOMINATOR
        ) {
            rewards =
                ((currentGTokenPrice - userVaultInfo.entryPrice) *
                    userVaultInfo.shares *
                    userVaultInfo.debt) /
                (userVaultInfo.depositAmount + userVaultInfo.debt);
        }
        // return (Debt  + (Price of gDAI x Price Change % x Reward Split %) / (gDAI price * quantity)
        return (
            ((totalDebt + rewards) * 1e18 * DENOMINATOR) /
                (currentGTokenPrice * quantity),
            currentGTokenPrice
        );
    }

    /** ---------------- View functions --------------- */
    function nativeTokenAddress() external view returns (address) {
        return nativeToken;
    }

    function uniswapRouterAddress() external view returns (address) {
        return uniswapRouter;
    }

    function gainsVaultAddress() external view returns (address) {
        return gainsVault;
    }

    function lendingVaultAddress() external view returns (address) {
        return lendingVault;
    }

    function supportCoinsList() external view returns (address[] memory) {
        return supportCoins;
    }

    function vaultInfoOf(
        address user,
        address token
    ) external view returns (VaultInfo memory) {
        return vaultInfo[user][token];
    }

    /**
     * @notice See {Gains network-asset}
     * @dev This is main default token in the Gains network. (Current it is DAI)
     *      We need to check our native token is different from this.
     *      If the gains network has changed the asset token, we must also change the native token.
     * @return address default native token address
     */
    function assetOfGains() external view returns (address) {
        return IGainsVault(gainsVault).asset();
    }

    /** @notice See {Gains network-maxDeposit}
     *  @param user Address of the user you wish to deposit
     *  @return maxDeposit Max deposit amount that _owner can deposit
     */
    function availableMaxDepositOf(
        address user
    ) external view returns (uint256) {
        return IGainsVault(gainsVault).maxDeposit(user);
    }

    /** @notice See {Gains network-convertToShares}
     *  @param assets Asset token (DAI) amount
     *  @return shares gDAI token amount
     */
    function convertToShares(uint256 assets) external view returns (uint256) {
        return IGainsVault(gainsVault).convertToShares(assets);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return IGainsVault(gainsVault).previewRedeem(shares);
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return IGainsVault(gainsVault).previewWithdraw(assets);
    }

    function hasPendingRequest(uint256 epochId) external view returns (bool) {
        return totalPendingRequests[epochId] > 0;
    }

    function hasPendingRequestNow() external view returns (bool) {
        uint256 currentEpochId = currentEpoch();
        return totalPendingRequests[currentEpochId] > 0;
    }

    /// @notice Returns the global id of the current spoch.
    function currentEpoch() public view returns (uint256) {
        return IGainsVault(gainsVault).currentEpoch();
    }

    /// @notice Returns the start timestamp of the current epoch.
    function currentEpochStart() public view returns (uint256) {
        return IGainsVault(gainsVault).currentEpochStart();
    }

    function getAmountsIn(address inputToken, address outputToken, uint256 amountOut) public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = inputToken;
        path[1] = outputToken;
        uint256[] memory amounts = IUniswapV2Router01(uniswapRouter).getAmountsIn(amountOut, path);
        return amounts[0];
    }

    function availableWithdrawRequestAmount(
        address user,
        address token
    ) public view returns (uint256) {
        return
            vaultInfo[user][token].shares -
            totalSharesBeingWithdrawn(user) -
            vaultInfo[user][token].withdrawed;
    }

    /// @notice Returns the epochs time(date) of the next withdraw
    function withdrawEpochsTimelock() public view returns (uint256) {
        return IGainsVault(gainsVault).withdrawEpochsTimelock();
    }

    function isAvailableWithdrawOrRequest() public view returns (bool) {
        return block.timestamp < currentEpochStart() + MAX_WITHIN_TIME;
    }

    function totalSharesBeingWithdrawn(
        address owner
    ) public view returns (uint256 shares) {
        uint256 currentEpochNumber = currentEpoch();
        // 3 is max date of WITHDRAW_EPOCHS_LOCKS
        // WITHDRAW_EPOCHS_LOCKS is constant variable in the Gains network so can't change this value
        for (uint256 i = currentEpochNumber; i <= currentEpochNumber + 3; i++) {
            shares += withdrawRequest[owner][i] + pendingRequest[owner][i];
        }
    }

    function gTokenPrice() public view returns (uint256) {
        return IGainsVault(gainsVault).shareToAssetsPrice();
    }

    function isLiquidation(address user, address token) public view returns (bool) {
        VaultInfo memory userVaultInfo = vaultInfo[user][token];
        uint256 currentGTokenPrice = gTokenPrice();
        uint256 quantity = userVaultInfo.depositAmount + userVaultInfo.debt;
        // Price movement (When gToken price changes >= +2%)
        uint256 rewards = 0;
        if (
            userVaultInfo.entryPrice > 0 &&
            currentGTokenPrice >= (userVaultInfo.entryPrice * (PRICE_SLIPPAGE + DENOMINATOR)) / DENOMINATOR
        ) {
            rewards = ((currentGTokenPrice - userVaultInfo.entryPrice) * userVaultInfo.shares * userVaultInfo.debt)
                / quantity;
        }
        // return (Debt  + (Price of gDAI x Price Change % x Reward Split %) / (gDAI price * quantity)
        return ((userVaultInfo.debt + rewards) * 1e18 * DENOMINATOR) / (currentGTokenPrice * quantity) >= MAX_DTV;
    }

    /** ----------- Change onlyOwner functions ------------- */
    function setPaused(bool pause) external onlyOwner {
        paused = pause;
    }

    function changeProtocolFee(
        address feeReceiver,
        uint256 percent
    ) external onlyOwner {
        protocolFee = feeReceiver;
        protocolFeePc = percent;
    }

    function changeNativeToken(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        nativeToken = newAddr;
    }

    function changeUniswapRouter(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        uniswapRouter = newAddr;
    }

    function changeGainsVault(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        gainsVault = newAddr;
    }

    function changeLendingVault(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        lendingVault = newAddr;
    }

    function addSupportCoin(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        supportCoins.push(newAddr);
    }

    function removeSupportCoin(address removeCoin) external onlyOwner {
        // Currently, we only support 4 coins so there is not much cost within the loop.
        for (uint256 i = 0; i < supportCoins.length; i++) {
            if (supportCoins[i] == removeCoin) {
                supportCoins[i] = supportCoins[supportCoins.length - 1];
                supportCoins.pop();
            }
        }
    }

    function liquidate(address user, address token) external onlyOwner {
        if (isLiquidation(user, token)) {
            makeWithdrawRequest(user, availableWithdrawRequestAmount(user, token));
        }
    }

    /** --------------------- Error --------------------- */
    error ZeroAddress();
    /// @notice Emitted when the deposit token is an unsupported stableCoin
    error UnSupportedCoin();
    /// @notice Emitted user deposit token when deposit is paused
    error Paused();
    error ExcessedMaximum(uint256 value, uint256 max);
    error NotDepositer();
    error MoreThanBalance();
    error EndOfEpoch();
    error NoPendingRequests();

    /** --------------------- Event --------------------- */
    event Deposit(
        address indexed depositer,
        address depositToken,
        uint256 depositTokenAmount,
        uint256 lendAmount,
        uint256 shares,
        uint256 createdAt
    );
    event PendingWithdrawRequested(
        address indexed owner,
        uint256 epochId,
        uint256 shares,
        uint256 createdAt
    );
    event Withdraw(
        address indexed owner,
        uint256 gTokenAmountToWithdraw,
        address indexed token,
        uint256 userReceivedTokenAmount,
        uint256 createdAt
    );
}
