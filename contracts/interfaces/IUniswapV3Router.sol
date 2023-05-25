// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

interface IUniswapV3Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) external payable returns (uint256 amountOut);
}
