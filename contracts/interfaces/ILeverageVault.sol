// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

interface ILeverageVault {
    function totalDebt() external view returns (uint256);

    function totalDebtToLend() external view returns (uint256);
}