// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PriceOracle} from "./PriceOracle.sol";

/// @title LanternExchange
/// @notice Isolated-margin long/short positions on a fixed list of equity markets.
///         Traders post stablecoin margin and pick 1-10x leverage. A shared liquidity vault
///         is the counterparty: it collects losses and fees and pays out profits.
///
///         Accounting invariant: collateral.balanceOf(this) == vaultAssets + totalMargin.
///         Vault shares (LNV) are a plain ERC-20; their value is vaultAssets / totalSupply.
contract LanternExchange is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant PRICE_ONE = 1e8;

    struct Market {
        string symbol;
        uint16 maxLeverage; // e.g. 10
        bool enabled;
        uint256 longNotional;
        uint256 shortNotional;
    }

    struct Position {
        address trader;
        uint32 marketId;
        bool isLong;
        uint64 openedAt;
        uint256 margin; // collateral units
        uint256 size; // notional at entry, collateral units
        uint256 entryPrice; // 1e8
    }

    IERC20 public immutable collateral;
    uint8 private immutable _shareDecimals; // shares are minted 1:1 with collateral units at first deposit
    PriceOracle public immutable oracle;

    uint256 public feeBps = 10; // 0.10% of notional on open and on close
    uint256 public maintenanceBps = 500; // liquidatable below 5% of notional
    uint256 public liquidationRewardBps = 50; // 0.50% of notional, capped by what is left
    uint256 public maxNetExposureBps = 5_000; // |long - short| notional <= 50% of vault
    uint256 public minMargin; // collateral units

    uint256 public vaultAssets;
    uint256 public totalMargin;

    Market[] private _markets;
    mapping(uint256 => Position) private _positions;
    uint256 public nextPositionId = 1;
    mapping(address => uint256[]) private _positionsOf;

    event MarketSet(uint256 indexed marketId, string symbol, uint16 maxLeverage, bool enabled);
    event Opened(uint256 indexed id, address indexed trader, uint256 indexed marketId, bool isLong, uint256 margin, uint256 size, uint256 price, uint256 fee);
    event MarginAdded(uint256 indexed id, uint256 amount);
    event Closed(uint256 indexed id, address indexed trader, uint256 indexed marketId, uint256 price, int256 pnl, uint256 payout, uint256 fee);
    event Liquidated(uint256 indexed id, address indexed trader, address indexed liquidator, uint256 price, uint256 reward);
    event Deposit(address indexed lp, uint256 assets, uint256 shares);
    event Withdraw(address indexed lp, uint256 assets, uint256 shares);
    event ParamsSet(uint256 feeBps, uint256 maintenanceBps, uint256 liquidationRewardBps, uint256 maxNetExposureBps, uint256 minMargin);

    error BadMarket();
    error MarketDisabled();
    error BadLeverage();
    error MarginTooSmall();
    error ExposureCap();
    error NotOwnerOfPosition();
    error NoPosition();
    error NotLiquidatable();
    error Liquidatable();
    error ZeroAmount();
    error VaultInUse();
    error BadParams();

    constructor(address owner_, IERC20 collateral_, PriceOracle oracle_, uint256 minMargin_)
        ERC20("Lantern Vault Share", "LNV")
        Ownable(owner_)
    {
        collateral = collateral_;
        _shareDecimals = IERC20Metadata(address(collateral_)).decimals();
        oracle = oracle_;
        minMargin = minMargin_;
    }

    // ───────────────────────────── vault ─────────────────────────────

    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        shares = supply == 0 || vaultAssets == 0 ? assets : (assets * supply) / vaultAssets;
        if (shares == 0) revert ZeroAmount();
        collateral.safeTransferFrom(msg.sender, address(this), assets);
        vaultAssets += assets;
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, assets, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        assets = (shares * vaultAssets) / totalSupply();
        _burn(msg.sender, shares);
        vaultAssets -= assets;
        // the vault must still cover the current open exposure after the withdrawal
        if (_netExposure() * BPS > vaultAssets * maxNetExposureBps) revert VaultInUse();
        collateral.safeTransfer(msg.sender, assets);
        emit Withdraw(msg.sender, assets, shares);
    }

    // ───────────────────────────── trading ─────────────────────────────

    /// @param margin collateral posted, including the opening fee
    function open(uint256 marketId, bool isLong, uint256 margin, uint256 leverage)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (marketId >= _markets.length) revert BadMarket();
        Market storage m = _markets[marketId];
        if (!m.enabled) revert MarketDisabled();
        if (leverage < 1 || leverage > m.maxLeverage) revert BadLeverage();
        if (margin < minMargin || margin == 0) revert MarginTooSmall();

        uint256 price = oracle.priceOf(marketId);
        uint256 fee = (margin * leverage * feeBps) / BPS;
        uint256 net = margin - fee;
        uint256 size = net * leverage;

        if (isLong) m.longNotional += size;
        else m.shortNotional += size;
        if (_netExposure() * BPS > vaultAssets * maxNetExposureBps) revert ExposureCap();

        collateral.safeTransferFrom(msg.sender, address(this), margin);
        vaultAssets += fee;
        totalMargin += net;

        id = nextPositionId++;
        _positions[id] = Position(msg.sender, uint32(marketId), isLong, uint64(block.timestamp), net, size, price);
        _positionsOf[msg.sender].push(id);
        emit Opened(id, msg.sender, marketId, isLong, net, size, price, fee);
    }

    function addMargin(uint256 id, uint256 amount) external nonReentrant {
        Position storage p = _positions[id];
        if (p.trader == address(0)) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        p.margin += amount;
        totalMargin += amount;
        emit MarginAdded(id, amount);
    }

    function close(uint256 id) external nonReentrant returns (uint256 payout) {
        Position memory p = _positions[id];
        if (p.trader == address(0)) revert NoPosition();
        if (p.trader != msg.sender) revert NotOwnerOfPosition();
        uint256 price = oracle.priceOf(p.marketId);
        int256 pnl = _pnl(p, price);
        uint256 fee = (p.size * feeBps) / BPS;
        int256 equity = int256(p.margin) + pnl - int256(fee);
        payout = equity > 0 ? uint256(equity) : 0;
        _settle(id, p, payout);
        emit Closed(id, p.trader, p.marketId, price, pnl, payout, fee);
        if (payout > 0) collateral.safeTransfer(p.trader, payout);
    }

    function liquidate(uint256 id) external nonReentrant returns (uint256 reward) {
        Position memory p = _positions[id];
        if (p.trader == address(0)) revert NoPosition();
        uint256 price = oracle.priceOf(p.marketId);
        int256 equity = int256(p.margin) + _pnl(p, price);
        if (equity >= int256((p.size * maintenanceBps) / BPS)) revert NotLiquidatable();
        uint256 left = equity > 0 ? uint256(equity) : 0;
        reward = (p.size * liquidationRewardBps) / BPS;
        if (reward > left) reward = left;
        // the trader receives nothing; the reward leaves via _settle's payout slot
        _settle(id, p, reward);
        emit Liquidated(id, p.trader, msg.sender, price, reward);
        if (reward > 0) collateral.safeTransfer(msg.sender, reward);
    }

    /// @dev Removes the position and moves everything that is not `payout` into the vault.
    ///      If payout exceeds the margin, the difference comes out of the vault (trader profit).
    function _settle(uint256 id, Position memory p, uint256 payout) private {
        Market storage m = _markets[p.marketId];
        if (p.isLong) m.longNotional -= p.size;
        else m.shortNotional -= p.size;
        totalMargin -= p.margin;
        if (payout >= p.margin) {
            uint256 profit = payout - p.margin;
            // exposure caps keep this solvent; clamp as a last line of defence
            if (profit > vaultAssets) {
                profit = vaultAssets;
                payout = p.margin + profit;
            }
            vaultAssets -= profit;
        } else {
            vaultAssets += p.margin - payout;
        }
        delete _positions[id];
    }

    function _pnl(Position memory p, uint256 price) private pure returns (int256) {
        int256 move = int256(price) - int256(p.entryPrice);
        int256 raw = (int256(p.size) * move) / int256(p.entryPrice);
        return p.isLong ? raw : -raw;
    }

    /// @dev Sum over markets of |long - short| notional: what the vault is actually exposed to.
    function _netExposure() private view returns (uint256 net) {
        for (uint256 i = 0; i < _markets.length; i++) {
            uint256 l = _markets[i].longNotional;
            uint256 s = _markets[i].shortNotional;
            net += l > s ? l - s : s - l;
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function market(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    function markets() external view returns (Market[] memory) {
        return _markets;
    }

    function position(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    /// @notice Open positions of `trader` (closed ones are skipped).
    function positionsOf(address trader) external view returns (uint256[] memory ids, Position[] memory list) {
        uint256[] storage all = _positionsOf[trader];
        uint256 n;
        for (uint256 i = 0; i < all.length; i++) if (_positions[all[i]].trader != address(0)) n++;
        ids = new uint256[](n);
        list = new Position[](n);
        uint256 k;
        for (uint256 i = 0; i < all.length; i++) {
            Position memory p = _positions[all[i]];
            if (p.trader != address(0)) {
                ids[k] = all[i];
                list[k++] = p;
            }
        }
    }

    /// @notice Unrealised PnL and equity at the current oracle price.
    function positionValue(uint256 id) external view returns (int256 pnl, int256 equity, bool liquidatable) {
        Position memory p = _positions[id];
        if (p.trader == address(0)) revert NoPosition();
        uint256 price = oracle.priceOf(p.marketId);
        pnl = _pnl(p, price);
        equity = int256(p.margin) + pnl;
        liquidatable = equity < int256((p.size * maintenanceBps) / BPS);
    }

    /// @notice Price at which a position becomes liquidatable.
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position memory p = _positions[id];
        if (p.trader == address(0)) revert NoPosition();
        // equity = margin + size*(P-E)/E*dir == size*maint  =>  P = E * (1 + dir*(maint*size - margin)/size)
        int256 e = int256(p.entryPrice);
        int256 k = (int256((p.size * maintenanceBps) / BPS) - int256(p.margin)) * e / int256(p.size);
        int256 price = p.isLong ? e + k : e - k;
        return price > 0 ? uint256(price) : 0;
    }

    function netExposure() external view returns (uint256) {
        return _netExposure();
    }

    // ───────────────────────────── admin ─────────────────────────────

    function addMarket(string calldata symbol, uint16 maxLeverage) external onlyOwner returns (uint256 id) {
        if (maxLeverage < 1 || maxLeverage > 50) revert BadLeverage();
        id = _markets.length;
        _markets.push(Market(symbol, maxLeverage, true, 0, 0));
        emit MarketSet(id, symbol, maxLeverage, true);
    }

    /// @notice Disabling only blocks new positions; existing ones can still close and be liquidated.
    function setMarket(uint256 id, uint16 maxLeverage, bool enabled) external onlyOwner {
        if (id >= _markets.length) revert BadMarket();
        if (maxLeverage < 1 || maxLeverage > 50) revert BadLeverage();
        _markets[id].maxLeverage = maxLeverage;
        _markets[id].enabled = enabled;
        emit MarketSet(id, _markets[id].symbol, maxLeverage, enabled);
    }

    function setParams(uint256 feeBps_, uint256 maintenanceBps_, uint256 rewardBps_, uint256 maxNetExposureBps_, uint256 minMargin_)
        external
        onlyOwner
    {
        if (feeBps_ > 100 || maintenanceBps_ == 0 || maintenanceBps_ >= 5_000 || rewardBps_ > maintenanceBps_ || maxNetExposureBps_ > BPS) {
            revert BadParams();
        }
        feeBps = feeBps_;
        maintenanceBps = maintenanceBps_;
        liquidationRewardBps = rewardBps_;
        maxNetExposureBps = maxNetExposureBps_;
        minMargin = minMargin_;
        emit ParamsSet(feeBps_, maintenanceBps_, rewardBps_, maxNetExposureBps_, minMargin_);
    }

    /// @notice Vault shares use the collateral's decimals, so 1 LNV starts out worth 1 USDG.
    function decimals() public view override returns (uint8) {
        return _shareDecimals;
    }
}
