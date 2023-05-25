// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

interface ILendingVault {
    function lend(uint256 amount, uint256 xLevel) external returns (uint256);

    function rewardSplit() external view returns (uint256);

    function allocateDebt(uint256 amount) external;
}