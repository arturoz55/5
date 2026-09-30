// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PriceOracle
/// @notice Keeper-fed price store. Prices use 8 decimals (1 USD = 1e8).
///         The exchange refuses to trade on a price older than `maxAge`.
contract PriceOracle is Ownable {
    struct Price {
        uint128 price;
        uint64 updatedAt;
    }

    uint256 public maxAge = 1 hours;
    uint256 public maxMoveBps = 2_000; // a single update may move price at most 20%
    mapping(address => bool) public isKeeper;
    mapping(uint256 marketId => Price) private _prices;

    event KeeperSet(address indexed keeper, bool allowed);
    event PriceUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp);
    event ParamsSet(uint256 maxAge, uint256 maxMoveBps);

    error NotKeeper();
    error BadPrice();
    error Stale(uint256 marketId, uint256 updatedAt);
    error MoveTooLarge(uint256 marketId, uint256 oldPrice, uint256 newPrice);
    error LengthMismatch();

    constructor(address owner_) Ownable(owner_) {}

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setParams(uint256 maxAge_, uint256 maxMoveBps_) external onlyOwner {
        maxAge = maxAge_;
        maxMoveBps = maxMoveBps_;
        emit ParamsSet(maxAge_, maxMoveBps_);
    }

    /// @notice Push prices. The first price for a market is unbounded; later ones are bounded by maxMoveBps.
    function push(uint256[] calldata marketIds, uint256[] calldata prices) external {
        if (!isKeeper[msg.sender]) revert NotKeeper();
        if (marketIds.length != prices.length) revert LengthMismatch();
        for (uint256 i = 0; i < marketIds.length; i++) {
            uint256 p = prices[i];
            if (p == 0 || p > type(uint128).max) revert BadPrice();
            Price storage cur = _prices[marketIds[i]];
            if (cur.price != 0) {
                uint256 diff = p > cur.price ? p - cur.price : cur.price - p;
                if (diff * 10_000 > uint256(cur.price) * maxMoveBps) revert MoveTooLarge(marketIds[i], cur.price, p);
            }
            cur.price = uint128(p);
            cur.updatedAt = uint64(block.timestamp);
            emit PriceUpdated(marketIds[i], p, block.timestamp);
        }
    }

    /// @notice Latest price and its timestamp, without a freshness check (for display).
    function latest(uint256 marketId) external view returns (uint256 price, uint256 updatedAt) {
        Price memory p = _prices[marketId];
        return (p.price, p.updatedAt);
    }

    /// @notice Fresh price or revert. Used for every trade, close and liquidation.
    function priceOf(uint256 marketId) external view returns (uint256) {
        Price memory p = _prices[marketId];
        if (p.price == 0 || block.timestamp - p.updatedAt > maxAge) revert Stale(marketId, p.updatedAt);
        return p.price;
    }
}
