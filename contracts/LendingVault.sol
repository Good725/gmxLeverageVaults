// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "hardhat/console.sol";

contract LendingVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    address public admin;
    address public nativeToken; // DAI
    address public leverageVault; // Leverage Vault address
    address private uniswapRouter;
    address public protocolFee; // protocol fee receiver address
    address[] private supportCoins; // Support stableCoins: USDC, USDT, FRAX

    uint256 public maxUtilityRate = 8000; // 80%
    uint256 public totalDeposited; // 1e18 (assets)
    uint256 public protocolFeePc = 50; // 0.5%
    uint256 public totalDebt;

    uint256 public constant DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_SPLIT1 = 4000; // 40%
    uint256 public constant MAX_FEE_SPLIT1_VALUE = 2500; // 25%
    uint256 public constant MAX_FEE_SPLIT2 = 8000; // 80%
    uint256 public constant MAX_FEE_SPLIT2_VALUE = 2900; // 29%
    uint256 public constant MAX_FEE_SPLIT3 = 10000; // 100%
    uint256 public constant MAX_FEE_SPLIT3_VALUE = 9000; // 90%
    uint256 public constant UR_THRESHOLD1 = 4000; // 40%
    uint256 public constant UR_THRESHOLD2 = 8000; // 80%
    uint256 public constant UR_THRESHOLD3 = 10000; // 100%

    modifier onlyLeverageVault(address _caller) {
        if (_caller != leverageVault) {
            revert NotLeverageVault();
        }
        _;
    }

    modifier zeroAddress(address addr) {
        if (addr == address(0)) {
            revert ZeroAddress();
        }
        _;
    }

    modifier checks(uint256 assetsOrShares) {
        require(assetsOrShares > 0, "VALUE_0");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "caller is not the admin");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        address token,
        address _router,
        address _protocolFee,
        address _admin,
        address[] memory _supportCoins
    ) ERC20(name, symbol) ERC4626(IERC20(token)) {
        nativeToken = token;
        uniswapRouter = _router;
        protocolFee = _protocolFee;
        admin = _admin;
        supportCoins = _supportCoins;
    }

    function lend(
        uint256 amount,
        uint256 xLevel
    ) external onlyLeverageVault(msg.sender) returns (uint256 lendAmount) {
        if (!isEnoughLendingAmount(amount, xLevel)) {
            revert NotEnoughAmount();
        }
        lendAmount = (amount * xLevel) / 100;
        totalDebt += lendAmount;
        IERC20(nativeToken).safeTransfer(msg.sender, lendAmount);
    }

    function allocateDebt(
        uint256 amount
    ) external onlyLeverageVault(msg.sender) {
        if (totalDebt > amount) totalDebt -= amount;
        else totalDebt = 0;
    }

    /** @dev See {IERC4626-deposit}. */
    function deposit(
        uint256 assets,
        address receiver
    ) public override checks(assets) returns (uint256) {
        // TODO: Check
        // require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

        IERC20(nativeToken).safeTransferFrom(msg.sender, address(this), assets);
        uint256 actualAmount = assets - _chargeFee(nativeToken, assets);
        uint256 shares = previewDeposit(actualAmount);

        _scaleVariables(shares, actualAmount, true);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, actualAmount, shares);

        return shares;
    }

    /** @dev Deposit supportCoins, not DAI */
    function depositStableCoin(
        address token,
        uint256 assets,
        address receiver
    ) external checks(assets) returns (uint256) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), assets);
        uint256 protocolFeeAmount = _chargeFee(token, assets);

        uint256 actualAmount = _swapTokensForToken(
            token,
            nativeToken,
            assets - protocolFeeAmount
        );

        uint256 shares = previewDeposit(actualAmount);
        _scaleVariables(shares, actualAmount, true);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, actualAmount, shares);

        return shares;
    }

    /** @dev See {IERC4626-withdraw}. */
    function withdraw(
        uint256 assets, // Native (DAI) token amount
        address receiver,
        address owner
    ) public override checks(assets) returns (uint256) {
        (uint256 _assets, uint256 shares) = _withdrawToken(
            nativeToken,
            assets,
            owner
        );
        _withdraw(_msgSender(), receiver, owner, _assets, shares);
        return shares;
    }

    /** @dev Withdraw supportCoins, not DAI */
    function withdrawStableCoin(
        address token,
        uint256 assets, // Withdraw input token amount
        address receiver,
        address owner
    ) external checks(assets) returns (uint256) {
        (uint256 _assets, uint256 shares) = _withdrawToken(
            token,
            assets,
            owner
        );
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);
        IERC20(token).safeTransfer(receiver, _assets);

        emit Withdraw(msg.sender, receiver, owner, _assets, shares);
        return shares;
    }

    /** @dev See {IERC4626-redeem}. */
    function redeem(
        uint256 shares, // Water token amount
        address receiver,
        address owner
    ) public override checks(shares) returns (uint256) {
        uint256 _assets = _redeem(nativeToken, shares, owner);
        _withdraw(_msgSender(), receiver, owner, _assets, shares);
        return _assets;
    }

    /** @dev Redeem supportCoins, not DAI */
    function redeemStableCoin(
        address token,
        uint256 shares, // Water token amount
        address receiver,
        address owner
    ) external checks(shares) returns (uint256) {
        uint256 _assets = _redeem(token, shares, owner);
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);
        IERC20(token).safeTransfer(receiver, _assets);

        emit Withdraw(msg.sender, receiver, owner, _assets, shares);
        return _assets;
    }

    /** ---------------- View functions --------------- */
    function balanceOfDAI() public view returns (uint256) {
        return IERC20(nativeToken).balanceOf(address(this));
    }

    function isEnoughLendingAmount(
        uint256 amount,
        uint256 xLevel
    ) public view returns (bool) {
        // The utilization rate of Lending Vault should be 80%, once exceeded then disable lend
        // Currently we are using 3x gDAI strategy for DAI holders, so x gDAI level is 2
        return
            (balanceOfDAI() * maxUtilityRate) / DENOMINATOR >=
            (amount * xLevel) / 100;
    }

    function priceOfWater() public view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply > 0) {
            return (totalAssets() * 1e18) / _totalSupply;
        }
        return 1e18;
    }

    function rewardSplit() public view returns (uint256) {
        uint256 ur = utilizationRate();
        if (ur <= MAX_FEE_SPLIT1) {
            return (MAX_FEE_SPLIT1_VALUE * ur) / UR_THRESHOLD1;
        } else if (ur <= MAX_FEE_SPLIT2) {
            return
                MAX_FEE_SPLIT1_VALUE +
                ((ur - UR_THRESHOLD1) * (MAX_FEE_SPLIT2_VALUE - MAX_FEE_SPLIT1_VALUE)) /
                    (DENOMINATOR - UR_THRESHOLD1 - (UR_THRESHOLD3 - UR_THRESHOLD2));
        } else if (ur <= MAX_FEE_SPLIT3) {
            return
                MAX_FEE_SPLIT2_VALUE +
                ((ur - UR_THRESHOLD2) *
                    (MAX_FEE_SPLIT3_VALUE - MAX_FEE_SPLIT2_VALUE)) /
                (DENOMINATOR - UR_THRESHOLD2);
        }
        return 0;
    }

    function getAmountsOut(
        address inputToken,
        address outputToken,
        uint256 amountIn
    ) public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = inputToken;
        path[1] = outputToken;
        uint256[] memory amounts = IUniswapV2Router01(uniswapRouter)
            .getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
    }

    function getAmountsIn(
        address inputToken,
        address outputToken,
        uint256 amountOut
    ) public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = inputToken;
        path[1] = outputToken;
        uint256[] memory amounts = IUniswapV2Router01(uniswapRouter)
            .getAmountsIn(amountOut, path);
        return amounts[0];
    }

    function utilizationRate() public view returns (uint256) {
        return totalAssets() == 0 ? 0 : (totalDebt * DENOMINATOR) / totalAssets();
    }

    /** ----------- Change onlyOwner functions ------------- */
    function changeNativeToken(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        nativeToken = newAddr;
    }

    function changeLeverageVault(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        leverageVault = newAddr;
    }

    function changeProtocolFee(
        address feeReceiver,
        uint256 percent
    ) external onlyOwner {
        protocolFee = feeReceiver;
        protocolFeePc = percent;
    }

    /** ---------------- Private functions --------------- */
    function _scaleVariables(
        uint256 shares,
        uint256 assets,
        bool isDeposit
    ) private {
        // TODO: Update info
        uint256 supply = totalSupply();

        totalDeposited = isDeposit
            ? totalDeposited + assets
            : totalDeposited - assets;
    }

    function _redeem(
        address token,
        uint256 shares,
        address owner
    ) private returns (uint256) {
        require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");
        uint256 assets = previewRedeem(shares);

        if (balanceOfDAI() < assets) revert NotEnoughAmount();

        _scaleVariables(shares, assets, false);
        if (token != nativeToken) {
            // Amount of token the user wants to withdraw
            assets = _swapTokensForToken(nativeToken, token, assets);
        }

        return assets - _chargeFee(token, assets);
    }

    function _withdrawToken(
        address token,
        uint256 assets,
        address owner
    ) private returns (uint256, uint256) {
        uint256 _assets = assets;
        if (token != nativeToken) {
            _assets = getAmountsIn(nativeToken, token, _assets);
        }

        require(
            _assets <= maxWithdraw(owner),
            "ERC4626: withdraw more than max"
        );
        if (balanceOfDAI() < _assets) revert NotEnoughAmount();

        uint256 shares = previewWithdraw(_assets);
        _scaleVariables(shares, _assets, false);

        uint256 userAmount = _assets - _chargeFee(nativeToken, _assets);
        // convert DAI to withdraw token
        if (token != nativeToken) {
            // Amount of token the user wants to withdraw
            userAmount = _swapTokensForToken(nativeToken, token, userAmount);
        }
        // token amount, shares amount
        return (userAmount, shares);
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

    /** @dev See {IERC4626-totalAssets}. */
    function totalAssets() public view virtual override returns (uint256) {
        return balanceOfDAI() + totalDebt;
    }

    error ZeroAddress();
    /// @notice Emitted when the deposit token is an unsupported stableCoin
    error UnSupportedCoin();
    error NotEnoughAmount();
    error NotLeverageVault();
    error InvalidValue(uint256 value, uint256 denominator);
}
