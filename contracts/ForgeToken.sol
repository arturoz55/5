// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ForgeToken
/// @notice Fixed-supply ERC-20 minted once, in full, to the address given at construction.
///         No owner, no mint, no pause, no blacklist, no transfer tax.
contract ForgeToken is ERC20 {
    string public metadataURI;
    address public immutable creator;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        string memory metadataURI_,
        address creator_,
        address mintTo_
    ) ERC20(name_, symbol_) {
        metadataURI = metadataURI_;
        creator = creator_;
        _mint(mintTo_, supply_);
    }
}
