// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import "./interfaces/ILeverageVault.sol";

import "hardhat/console.sol";

contract LendingVaultV1 is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    address public admin;
    address public dai; // DAI
    address public leverageVault; // Leverage Vault address
    address public feeReceiver; // protocol fee receiver address

    uint256 public totalDeposited; // 1e18 (assets)
    uint256 public feePercent = 50; // 0.5%

    uint256 public constant DENOMINATOR = 10000;
    uint256 public constant MAX_UTILITY_RATE = 8000; // 80%
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
        address _dai,
        address _feeReceiver,
        address _admin
    ) ERC20(name, symbol) ERC4626(IERC20(_dai)) {
        dai = _dai;
        feeReceiver = _feeReceiver;
        admin = _admin;
    }

    function lend(
        uint256 amount,
        uint256 xLevel
    ) external onlyLeverageVault(msg.sender) returns (uint256 lendAmount) {
        if (!isEnoughLendingAmount(amount, xLevel)) {
            revert NotEnoughAmount();
        }
        lendAmount = (amount * xLevel) / 100;
        IERC20(dai).safeTransfer(msg.sender, lendAmount);
    }

    // function allocateDebt(
    //     uint256 amount
    // ) external onlyLeverageVault(msg.sender) {
    //     if (totalDebt > amount) totalDebt -= amount;
    //     else totalDebt = 0;
    // }

    /** @dev See {IERC4626-deposit}. */
    function deposit(
        uint256 assets,
        address receiver
    ) public override checks(assets) returns (uint256) {
        // TODO: Check
        // require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");
        uint256 actualAmount = assets - feeAmount(assets);
        uint256 shares = previewDeposit(actualAmount);

        IERC20(dai).safeTransferFrom(msg.sender, address(this), assets);
        _chargeFee(assets);

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
        (uint256 _assets, uint256 _shares) = _withdrawToken(assets, owner);
        _withdraw(_msgSender(), receiver, owner, _assets, _shares);
        return _shares;
    }

    /** @dev See {IERC4626-redeem}. */
    function redeem(
        uint256 shares, // Water token amount
        address receiver,
        address owner
    ) public override checks(shares) returns (uint256) {
        uint256 _assets = _redeem(shares, owner);
        _withdraw(_msgSender(), receiver, owner, _assets, shares);
        return _assets;
    }

    /** ---------------- View functions --------------- */
    function balanceOfDAI() public view returns (uint256) {
        return IERC20(dai).balanceOf(address(this));
    }

    function isEnoughLendingAmount(
        uint256 amount,
        uint256 xLevel
    ) public view returns (bool) {
        // The utilization rate of Lending Vault should be 80%, once exceeded then disable lend
        // Currently we are using 3x gDAI strategy for DAI holders, so x gDAI level is 2
        return
            (balanceOfDAI() * MAX_UTILITY_RATE) / DENOMINATOR >=
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

    function utilizationRate() public view returns (uint256) {
        return totalAssets() == 0 ? 0 : (totalDebt() * DENOMINATOR) / totalAssets();
    }

    function feeAmount(uint256 amount) public view returns (uint256) {
        return (amount * feePercent) / DENOMINATOR;
    }

    function totalDebt() public view returns (uint256) {
        return ILeverageVault(leverageVault).totalDebtToLend();
    }

    /** @dev See {IERC4626-totalAssets}. */
    function totalAssets() public view virtual override returns (uint256) {
        return balanceOfDAI() + totalDebt();
    }

    /** ----------- Change onlyOwner functions ------------- */
    function changeDai(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        dai = newAddr;
    }

    function changeLeverageVault(
        address newAddr
    ) external onlyOwner zeroAddress(newAddr) {
        leverageVault = newAddr;
    }

    function changeProtocolFee(
        address receiver,
        uint256 percent
    ) external onlyOwner {
        feeReceiver = receiver;
        feePercent = percent;
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

    function _redeem(uint256 shares, address owner) private returns (uint256) {
        require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");
        uint256 assets = previewRedeem(shares);

        if (balanceOfDAI() < assets) revert NotEnoughAmount();

        _scaleVariables(shares, assets, false);
        return assets - _chargeFee(assets);
    }

    function _withdrawToken(
        uint256 assets,
        address owner
    ) private returns (uint256, uint256) {
        uint256 _assets = assets;
        require(
            _assets <= maxWithdraw(owner),
            "ERC4626: withdraw more than max"
        );
        if (balanceOfDAI() < _assets) revert NotEnoughAmount();

        uint256 shares = previewWithdraw(_assets);
        _scaleVariables(shares, _assets, false);

        uint256 userAmount = _assets - _chargeFee(_assets);
        // token amount, shares amount
        return (userAmount, shares);
    }

    function _chargeFee(uint256 amount) private returns (uint256) {
        uint256 _feeAmount = feeAmount(amount);
        IERC20(dai).safeTransfer(feeReceiver, _feeAmount);
        return _feeAmount;
    }

    error ZeroAddress();
    error NotEnoughAmount();
    error NotLeverageVault();
    error InvalidValue(uint256 value, uint256 denominator);
}
