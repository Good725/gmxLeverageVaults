// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

interface INft is IERC721{
	function mint(address to, uint tokenId) external;
	function burn(uint tokenId) external;
}