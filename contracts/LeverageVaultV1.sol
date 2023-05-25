// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IGainsVault.sol";
import "./interfaces/ILendingVault.sol";

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract LeverageVaultV1 is Ownable {
    using SafeERC20 for IERC20;

    struct VaultInfo {
        uint256 depositAmount; // Deposit amount DAI
        uint256 debt; // debt amount when depositing (DAI)
        uint256 shares; // gToken (gDAI) amount received from Gains network after deposit
        uint256 divide; // totalDeposit / totalDebt * 1e18
        uint256 gTokenPrice; // gToken (gDAI) price
    }

    struct PendingWithdrawRequest {
        address owner;
        uint256 shares;
        uint256 timestamp;
    }

    bool public paused;

    address public admin;
    address private dai; // DAI
    /// Gains Network gDAI vault contract
    /// Example: 0x91993f2101cc758D0dEB7279d41e880F7dEFe827 (Gains Vault V6.3 gDAI contract Polygon mainnet)
    address private gainsVault;
    address private lendingVault; // Lending Vault contract address
    address public feeReceiver; // protocol fee receiver address
    address[] private depositers;
    address[] private liquidationUsers;

    uint256 public feePercent = 50; // 0.5%

    uint256 public totalDebt; // total debt amount from LendingVault
    uint256 public totalDepositAmount;
    uint256 public lastVLP; // gDAI price when last deposit, withdraw, price change
    uint256 public lastRewardSplit;

    /// If within the first 48 hours of the epoch, users can send withdrawal request and withdraw
    uint256 public constant MAX_WITHIN_TIME = 2 days;
    uint256 public constant PRICE_SLIPPAGE = 200; // 2%: When gToken price changes >= +/- 2%
    uint256 public constant DENOMINATOR = 10000;
    uint256 public constant MAX_DTV = 9000; // 90%
    /// 200 - lend 2x amount of deposit token (DAI or after converted to DAI)
    uint256 public constant X_LEVEL = 300;

    mapping(address => VaultInfo) private vaultInfo; // user address => VaultInfo
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

    modifier updateDebt() {
        // _updateDebt();
        _;
    }

    constructor(
        address _dai,
        address _gains,
        address _lendingVault,
        address _feeReceiver,
        address _admin
    ) {
        dai = _dai;
        gainsVault = _gains;
        lendingVault = _lendingVault;
        feeReceiver = _feeReceiver;
        admin = _admin;
        lastVLP = gTokenPrice();
    }

    /**
     * @notice Token Deposit
     * @dev Users can deposit with DAI
     * @param amount Deposit token amount
     */
    function deposit(uint256 amount) external isPaused updateDebt {
        IERC20(dai).safeTransferFrom(msg.sender, address(this), amount);

        uint256 feeAmount = _chargeFee(amount);
        uint256 actualAmount = amount - feeAmount;

        totalDepositAmount += actualAmount;

        // If xLevel is 200 (2x), should lend 2x DAI
        uint256 lendAmount = ILendingVault(lendingVault).lend(actualAmount, X_LEVEL - 100);

        // Actual deposit amount to Gains network
        uint256 xAmount = actualAmount + lendAmount;

        IERC20(dai).safeApprove(gainsVault, xAmount);
        // Don't need to check maxDeposit. Doing it from deposit of gains network.
        uint256 shares = IGainsVault(gainsVault).deposit(
            xAmount,
            address(this)
        );

        VaultInfo storage _vaultInfo = vaultInfo[msg.sender];
        uint256 vlp = gTokenPrice();

        if (_vaultInfo.shares == 0) {
            // Store new depositer
            depositers.push(msg.sender);
        }

        _vaultInfo.debt += _getMaxDebt(_vaultInfo.shares, _vaultInfo.gTokenPrice);
        _vaultInfo.depositAmount += actualAmount;
        _vaultInfo.shares += shares;
        _vaultInfo.divide = _vaultInfo.depositAmount * (X_LEVEL / 100) * 1e18 / _vaultInfo.shares;
        _vaultInfo.gTokenPrice = vlp;

        emit Deposit(
            msg.sender,
            amount,
            shares,
            block.timestamp
        );
    }

    /**
     * @notice Make a withdraw request with user wants amount gdai amount
     * @param shares gDAI amount for Redeem
     */
    function makeWithdrawRequest(uint256 shares) public {
        if (shares > availableWithdrawRequestAmount(msg.sender)) {
            revert MoreThanBalance();
        }
        _makeWithdrawRequest(msg.sender, shares);
    }

    /**
     * @notice Make a withdraw request with user wants amount dai amount
     * @param assets DAI amount for withdraw
     */
    function makeWithdrawRequestWithAssets(uint256 assets) public {
        uint256 shares = getSharesToWithdraw(msg.sender, assets);
        if (shares > availableWithdrawRequestAmount(msg.sender)) {
            revert MoreThanBalance();
        }
        _makeWithdrawRequest(msg.sender, shares);
    }

    /**
     * @notice Make a withdraw request with all deposited amount of the token
     */
    function makeWithdrawAllRequest() public {
        uint256 shares = availableWithdrawRequestAmount(msg.sender);
        _makeWithdrawRequest(msg.sender, shares);
    }

    /// @notice Make a withdraw request with a batch of all pending requests in the current epoch.
    function makeWithdrawRequestOfPending() external {
        if (!canWithdrawOrSendRequest()) {
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
    function redeem(uint256 shares) external updateDebt {
        uint256 assets = IGainsVault(gainsVault).redeem(
            shares,
            address(this),
            address(this)
        );
        _withdraw(msg.sender, assets, shares);
    }

    /**
     * @notice Token Withdraw
     * @dev Users can withdraw about the sent a withdraw request
     * @param assets DAI amount the user receive after withdrawing
     */
    function withdraw(uint256 assets) external updateDebt {
        uint256 totalAssets = getAssetsToWithdraw(msg.sender, assets);
        uint256 shares = IGainsVault(gainsVault).withdraw(
            totalAssets,
            address(this),
            address(this)
        );
        _withdraw(msg.sender, totalAssets, shares);
    }

    function updateDTV() external {
        uint256 gdaiPrice = gTokenPrice();
        lastRewardSplit = ILendingVault(lendingVault).rewardSplit();
        for (uint256 i = 0; i < depositers.length; i++) {
            VaultInfo storage _vaultInfo = vaultInfo[depositers[i]];
            if (gdaiPrice >= _vaultInfo.gTokenPrice * (DENOMINATOR + PRICE_SLIPPAGE) / DENOMINATOR) {
                totalDebt += _getMaxDebt(_vaultInfo.shares, _vaultInfo.gTokenPrice);
            }
        }
        lastVLP = gdaiPrice;
    }

    // /**
    //  * @notice Token Withdraw
    //  * @dev Users can withdraw about the sent a withdraw request
    //  * @param assets Withdraw DAI amount
    //  */
    // function withdraw(uint256 assets) external {
    //     uint256 shares = IGainsVault(gainsVault).withdraw(
    //         assets,
    //         address(this),
    //         address(this)
    //     );
    //     _withdraw(assets, shares);
    // }

    /** ---------------- View functions --------------- */
    function daiAddress() external view returns (address) {
        return dai;
    }

    function gainsVaultAddress() external view returns (address) {
        return gainsVault;
    }

    function lendingVaultAddress() external view returns (address) {
        return lendingVault;
    }

    function userInfo(address user) external view returns (VaultInfo memory) {
        return vaultInfo[user];
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
     *  @return maxDeposit Max deposit amount that _owner can deposit
     */
    function availableMaxDepositOf() external view returns (uint256) {
        return IGainsVault(gainsVault).maxDeposit(address(this));
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
        return totalPendingRequests[currentEpochId + 1] > 0;
    }

    function getLiquidationUsers() external view returns (address[] memory users) {
        uint256 gdaiPrice = gTokenPrice();
        uint256 index = 0;
        for (uint256 i = 0; i < depositers.length; i++) {
            VaultInfo storage _vaultInfo = vaultInfo[depositers[i]];
            if (_vaultInfo.gTokenPrice > gdaiPrice) {
                if (
                    (gdaiPrice * (_vaultInfo.depositAmount + _vaultInfo.debt) * DENOMINATOR)
                        / (_vaultInfo.debt * 1e18) >= MAX_DTV
                ) {
                    users[index] = depositers[i];
                    index += 1;
                }
            }
        }
    }

    function maxWithdrawAmountOf(address user) external view returns (uint256) {
        VaultInfo storage _vaultInfo = vaultInfo[user];
        uint256 gdaiPrice = gTokenPrice();
        uint256 totalAmount = _vaultInfo.shares * gdaiPrice / 1e18;
        uint256 debt = _vaultInfo.debt;
        if (_vaultInfo.gTokenPrice < lastVLP) {
            debt = _getMaxDebt(_vaultInfo.shares, _vaultInfo.gTokenPrice);
        }
        uint256 toLendingVault = _vaultInfo.depositAmount * (X_LEVEL - 100) / 100 + debt;
        return totalAmount - toLendingVault;
    }

    function totalDTV() external view returns (uint256) {
        uint256 assets = totalShares() * gTokenPrice() / 1e18;
        uint256 debt = totalDebt + totalDepositAmount * (X_LEVEL - 100) / 100;
        return debt * DENOMINATOR / assets;
    }

    function userDTV(address user) external view returns (uint256) {
        VaultInfo storage _vaultInfo = vaultInfo[user];
        uint256 assets = _vaultInfo.shares * gTokenPrice() / 1e18;
        uint256 debt = _vaultInfo.debt + _vaultInfo.depositAmount * (X_LEVEL - 100) / 100;
        return debt * DENOMINATOR / assets;
    }

    // function getTotalRewards() external view returns (uint256, uint256, uint256) {
    //     uint256 gdaiPrice = gTokenPrice();
    //     uint256 gdaiAmount = totalShares();
    //     uint256 rewards = gdaiAmount * gdaiPrice / 1e18 - totalDepositAmount * X_LEVEL / 100;
    //     uint256 debt = _getDebt(gdaiAmount, lastVLP);
    //     uint256 dtv = (totalDepositAmount * 2 + debt) * DENOMINATOR / (gdaiAmount * gdaiPrice / 1e18);
    //     return (rewards - debt, debt, dtv);
    // }

    function totalShares() public view returns (uint256) {
        return IERC20(gainsVault).balanceOf(address(this));
    }

    /// @notice Returns the global id of the current spoch.
    function currentEpoch() public view returns (uint256) {
        return IGainsVault(gainsVault).currentEpoch();
    }

    /// @notice Returns the start timestamp of the current epoch.
    function currentEpochStart() public view returns (uint256) {
        return IGainsVault(gainsVault).currentEpochStart();
    }

    function availableWithdrawRequestAmount(address user) public view returns (uint256) {
        return vaultInfo[user].shares - totalSharesBeingWithdrawn(user);
    }

    /// @notice Returns the epochs time(date) of the next withdraw
    function withdrawEpochsTimelock() public view returns (uint256) {
        return IGainsVault(gainsVault).withdrawEpochsTimelock();
    }

    function canWithdrawOrSendRequest() public view returns (bool) {
        return block.timestamp < currentEpochStart() + MAX_WITHIN_TIME;
    }

    /// Return shares amount for withdraw assets
    function getSharesToWithdraw(address user, uint256 assets) public view returns (uint256) {
        uint256 totalAssets = getAssetsToWithdraw(user, assets);
        return totalAssets * 1e18 / gTokenPrice() + 1e15; // 1e15: for fix underflowed or overflowed issue
    }

    /// Return total assets amount for withdraw assets
    function getAssetsToWithdraw(address user, uint256 assets) public view returns (uint256) {
        uint256 _leverageSize = leverageSize(user); // Should divide DENOMINATOR
        return assets * _leverageSize / DENOMINATOR;
    }

    /// totalAssets * 10000 / (totalAssets - totalDebt)
    function leverageSize(address user) public view returns (uint256) {
        VaultInfo storage _vaultInfo = vaultInfo[user];
        uint256 gdaiPrice = gTokenPrice();
        uint256 totalAssets = _vaultInfo.shares * gdaiPrice / 1e18;
        uint256 debt = _getDebt(_vaultInfo.shares, _vaultInfo.gTokenPrice);
        return totalAssets * DENOMINATOR / (totalAssets - (_vaultInfo.debt + debt + _vaultInfo.depositAmount * (X_LEVEL - 100) / 100));
    }

    function totalSharesBeingWithdrawn(address owner) public view returns (uint256 shares) {
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

    function totalDebtToLend() public view returns (uint256) {
        return totalDepositAmount * (X_LEVEL - 100) / 100 + totalDebt;
    }

    /** ----------- Change onlyAdmin functions ------------- */
    function liquidationRequest(address[] memory users) external onlyAdmin {
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] != address(0)) {
                liquidationUsers.push(users[i]);
                uint256 shares = availableWithdrawRequestAmount(users[i]);
                _makeWithdrawRequest(users[i], shares);
            }
        }
    }

    function liquidation() external onlyAdmin {
        uint256 currentEpochId = currentEpoch();
        for (uint256 i = 0; i < liquidationUsers.length; i++) {
            if (liquidationUsers[i] != address(0)) {
                uint256 shares = withdrawRequest[liquidationUsers[i]][currentEpochId];
                uint256 assets = IGainsVault(gainsVault).redeem(
                    shares,
                    address(this),
                    address(this)
                );
                _withdraw(liquidationUsers[i], assets, shares);
            }
        }
    }

    /** ----------- Change onlyOwner functions ------------- */
    function setPaused(bool pause) external onlyOwner {
        paused = pause;
    }

    function changeProtocolFee(
        address newFeeReceiver,
        uint256 newFercent
    ) external onlyOwner {
        feeReceiver = newFeeReceiver;
        feePercent = newFercent;
    }

    function changedai(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        dai = newAddr;
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

    /** ---------------- Private functions --------------- */
    /**
     * @notice Make a withdraw request
     * @dev Make a withdraw request for any amount of unlocked gDAI.
     *      User must make a request to withdraw your assets during the first 48 hours of any epoch
     *      This can only be done during the withdraw window of an epoch.
     *      Gains network emits an event for:
     *      <emit WithdrawRequested(sender, owner, shares, currentEpoch, unlockEpoch);>
     * @param user Withdraw user
     * @param shares gDAI amount for Redeem
     */
    function _makeWithdrawRequest(address user, uint256 shares) private {
        if (vaultInfo[user].shares == 0) {
            revert NotDepositer();
        }
        uint256 currentEpochId = currentEpoch();
        if (canWithdrawOrSendRequest()) {
            // Make a withdraw request
            uint256 unlockEpoch = currentEpochId + withdrawEpochsTimelock();
            withdrawRequest[user][unlockEpoch] += shares;

            // emit WithdrawRequested event from Gains network
            IGainsVault(gainsVault).makeWithdrawRequest(shares, address(this));
        } else {
            uint256 nextEpochId = currentEpochId + 1;
            totalPendingRequests[nextEpochId] += shares;
            pendingRequest[user][nextEpochId] += shares;
            pendingWithdrawRequests[nextEpochId].push(
                PendingWithdrawRequest({
                    owner: user,
                    shares: shares,
                    timestamp: block.timestamp
                })
            );

            emit PendingWithdrawRequested(
                user,
                nextEpochId,
                shares,
                block.timestamp
            );
        }
    }

    function _chargeFee(uint256 amount) private returns (uint256) {
        uint256 feeAmount = (amount * feePercent) / DENOMINATOR;
        IERC20(dai).safeTransfer(feeReceiver, feeAmount);
        return feeAmount;
    }

    /**
     * @notice Token Withdraw private function
     * @dev Users can withdraw about the sent a withdraw request
     * @param assets Withdraw DAI amount
     * @param shares gDAI amount the user wants to withdraw
     */
    function _withdraw(address user, uint256 assets, uint256 shares) private {
        if (!canWithdrawOrSendRequest()) {
            revert EndOfEpoch();
        }
        uint256 currentEpochId = currentEpoch();
        withdrawRequest[user][currentEpochId] -= shares;

        VaultInfo storage _vaultInfo = vaultInfo[user];
        _vaultInfo.shares -= shares;

        uint256 withdrawAmount = (shares * _vaultInfo.divide / 1e18) * 100 / (X_LEVEL);
        _vaultInfo.depositAmount = _vaultInfo.depositAmount >= withdrawAmount ? _vaultInfo.depositAmount - withdrawAmount : 0;
        totalDepositAmount = totalDepositAmount >= withdrawAmount ? totalDepositAmount - withdrawAmount : 0;

        // Withdrawal the DAI, and transfer 0.5% of all the DAI into the protocol address as the protocol fee
        uint256 feeAmount = _chargeFee(assets);
        // Actual withdrawal amount excluding protocol fee
        uint256 actualAmount = assets - feeAmount;

        uint256 debt = _getDebt(shares, _vaultInfo.gTokenPrice);
        uint256 debtToLend = withdrawAmount * (X_LEVEL - 100) / 100 + debt;
        totalDebt = totalDebt - debt;

        // Return lent amount and rewards amount to Lending vault and Update UR in lending Vault
        IERC20(dai).safeTransfer(lendingVault, debtToLend);
        // Transfer token to user
        IERC20(dai).safeTransfer(user, actualAmount - debtToLend);

        // If all withdrawed, Remove this user
        if (_vaultInfo.shares == 0) {
            delete vaultInfo[user];
            // TODO: Check we need this
            for (uint256 i = 0; i < depositers.length; i++) {
                if (depositers[i] == user) {
                    depositers[i] = depositers[depositers.length - 1];
                    depositers.pop();
                    break;
                }
            }
        }

        emit Withdraw(msg.sender, shares, actualAmount - debtToLend, block.timestamp);
    }

    function _updateDebt() private {
        uint256 gdaiPrice = gTokenPrice();
        totalDebt += _getDebt(totalShares(), lastVLP);
        lastVLP = gdaiPrice;
    }

    function _getDebt(uint256 shares, uint256 vlp) private view returns (uint256) {
        uint256 gdaiPrice = gTokenPrice();
        if (gdaiPrice > vlp) {
            uint256 rewards = shares * (gdaiPrice - vlp) / 1e18;
            return rewards * ILendingVault(lendingVault).rewardSplit() / DENOMINATOR;
        }
        return 0;
    }

    function _getMaxDebt(uint256 shares, uint256 vlp) private view returns (uint256) {
        uint256 gdaiPrice = gTokenPrice();
        if (gdaiPrice > vlp) {
            uint256 rewards = shares * (gTokenPrice() - vlp) / 1e18;
            return rewards * lastRewardSplit / DENOMINATOR;
        }
        return 0;
    }

    /** --------------------- Error --------------------- */
    error ZeroAddress();
    /// @notice Emitted when the deposit token is an unsupported stableCoin
    error UnSupportedCoin();
    /// @notice Emitted user deposit token when deposit is paused
    error Paused();
    error NotDepositer();
    error MoreThanBalance();
    error EndOfEpoch();
    error NoPendingRequests();

    /** --------------------- Event --------------------- */
    event Deposit(
        address indexed depositer,
        uint256 depositTokenAmount,
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
        uint256 userReceivedTokenAmount,
        uint256 createdAt
    );
}
