// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

interface IGnsToken{
    function burn(address to, uint amount) external;
    function mint(address from, uint amount) external;
}