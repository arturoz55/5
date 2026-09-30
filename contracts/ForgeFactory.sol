// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ForgeToken} from "./ForgeToken.sol";
import {ForgePool} from "./ForgePool.sol";

/// @title ForgeFactory
/// @notice One transaction launches a fixed-supply token and its permanently locked pool against
///         native TAO or an allow-listed reserve asset (e.g. a subnet-alpha wrapper).
contract ForgeFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct LaunchParams {
        string name;
        string symbol;
        uint256 supply; // in token wei (18 decimals)
        string metadata; // JSON: description, image, links, sector, kind, netuid
        address quote; // address(0) = native TAO
        uint256 quoteAmount; // initial reserve deposit
    }

    struct Launch {
        address token;
        address pool;
        address quote;
        address creator;
        uint64 createdAt;
    }

    struct LaunchView {
        address token;
        address pool;
        address quote;
        address creator;
        uint64 createdAt;
        string name;
        string symbol;
        string metadata;
        uint256 totalSupply;
        uint256 reserveToken;
        uint256 reserveQuote;
    }

    struct QuoteAsset {
        address asset;
        string label;
        bool allowed;
    }

    uint256 public constant MIN_SUPPLY = 1e18;
    uint256 public constant MAX_SUPPLY = 1e33; // 1e15 whole tokens
    uint256 public constant MAX_METADATA = 2048;

    address public treasury;
    uint256 public launchFee; // native TAO, paid on top of liquidity
    uint256 public minNativeLiquidity;

    Launch[] private _launches;
    mapping(address token => uint256 indexPlusOne) public launchIndexOfToken;
    mapping(address pool => bool) public isPool;
    mapping(address creator => uint256[]) private _byCreator;

    mapping(address asset => uint256 minLiquidity) public minQuoteLiquidity;
    mapping(address asset => bool) public quoteAllowed;
    QuoteAsset[] private _quoteAssets;
    mapping(address asset => uint256 indexPlusOne) private _quoteIndex;

    event LaunchCreated(
        uint256 indexed id,
        address indexed token,
        address indexed creator,
        address pool,
        address quote,
        uint256 supply,
        uint256 quoteAmount
    );
    event QuoteAssetSet(address indexed asset, string label, bool allowed, uint256 minLiquidity);
    event TreasurySet(address treasury);
    event LaunchFeeSet(uint256 fee);
    event MinNativeLiquiditySet(uint256 amount);

    error BadName();
    error BadSupply();
    error MetadataTooLong();
    error QuoteNotAllowed();
    error BadValue(uint256 expected, uint256 got);
    error LiquidityTooLow(uint256 min);
    error ZeroAddress();
    error FeeTransferFailed();

    constructor(address owner_, address treasury_, uint256 minNativeLiquidity_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        minNativeLiquidity = minNativeLiquidity_;
    }

    // ───────────────────────────── launch ─────────────────────────────

    function createLaunch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool)
    {
        uint256 nameLen = bytes(p.name).length;
        uint256 symLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 48 || symLen == 0 || symLen > 12) revert BadName();
        if (p.supply < MIN_SUPPLY || p.supply > MAX_SUPPLY) revert BadSupply();
        if (bytes(p.metadata).length > MAX_METADATA) revert MetadataTooLong();

        uint256 fee = launchFee;
        if (p.quote == address(0)) {
            if (p.quoteAmount < minNativeLiquidity || p.quoteAmount == 0) revert LiquidityTooLow(minNativeLiquidity);
            if (msg.value != fee + p.quoteAmount) revert BadValue(fee + p.quoteAmount, msg.value);
        } else {
            if (!quoteAllowed[p.quote]) revert QuoteNotAllowed();
            uint256 min = minQuoteLiquidity[p.quote];
            if (p.quoteAmount < min || p.quoteAmount == 0) revert LiquidityTooLow(min);
            if (msg.value != fee) revert BadValue(fee, msg.value);
        }

        ForgePool newPool = new ForgePool(p.quote, treasury);
        pool = address(newPool);
        token = address(new ForgeToken(p.name, p.symbol, p.supply, p.metadata, msg.sender, pool));

        if (p.quote == address(0)) {
            newPool.initialize{value: p.quoteAmount}(token);
        } else {
            IERC20(p.quote).safeTransferFrom(msg.sender, pool, p.quoteAmount);
            newPool.initialize(token);
        }

        if (fee > 0) {
            (bool ok,) = payable(treasury).call{value: fee}("");
            if (!ok) revert FeeTransferFailed();
        }

        uint256 id = _launches.length;
        _launches.push(Launch(token, pool, p.quote, msg.sender, uint64(block.timestamp)));
        launchIndexOfToken[token] = id + 1;
        isPool[pool] = true;
        _byCreator[msg.sender].push(id);

        emit LaunchCreated(id, token, msg.sender, pool, p.quote, p.supply, p.quoteAmount);
    }

    // ───────────────────────────── views ─────────────────────────────

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function launchAt(uint256 id) external view returns (Launch memory) {
        return _launches[id];
    }

    function launchIdsOf(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    /// @notice Newest-first page of launches with everything a market list needs in one call.
    function getLaunches(uint256 offset, uint256 limit) external view returns (LaunchView[] memory out) {
        uint256 n = _launches.length;
        if (offset >= n) return new LaunchView[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        out = new LaunchView[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = _view(n - 1 - offset - i);
        }
    }

    function getLaunch(uint256 id) external view returns (LaunchView memory) {
        return _view(id);
    }

    /// @notice Look up a launch by token address. Reverts if the token was not launched here.
    function getLaunchByToken(address token) external view returns (uint256 id, LaunchView memory v) {
        uint256 idx = launchIndexOfToken[token];
        require(idx != 0, "unknown token");
        id = idx - 1;
        v = _view(id);
    }

    function quoteAssets() external view returns (QuoteAsset[] memory) {
        return _quoteAssets;
    }

    function _view(uint256 id) private view returns (LaunchView memory v) {
        Launch storage l = _launches[id];
        ForgeToken t = ForgeToken(l.token);
        ForgePool pl = ForgePool(l.pool);
        v = LaunchView({
            token: l.token,
            pool: l.pool,
            quote: l.quote,
            creator: l.creator,
            createdAt: l.createdAt,
            name: t.name(),
            symbol: t.symbol(),
            metadata: t.metadataURI(),
            totalSupply: t.totalSupply(),
            reserveToken: pl.reserveToken(),
            reserveQuote: pl.reserveQuote()
        });
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Allow or disallow an ERC-20 reserve asset (e.g. a subnet-alpha wrapper).
    ///         Disallowing only affects new launches; existing pools keep trading.
    function setQuoteAsset(address asset, string calldata label, bool allowed, uint256 minLiquidity)
        external
        onlyOwner
    {
        if (asset == address(0)) revert ZeroAddress();
        // sanity check that it behaves like an ERC-20 with metadata
        IERC20Metadata(asset).decimals();
        quoteAllowed[asset] = allowed;
        minQuoteLiquidity[asset] = minLiquidity;
        uint256 idx = _quoteIndex[asset];
        if (idx == 0) {
            _quoteAssets.push(QuoteAsset(asset, label, allowed));
            _quoteIndex[asset] = _quoteAssets.length;
        } else {
            _quoteAssets[idx - 1].label = label;
            _quoteAssets[idx - 1].allowed = allowed;
        }
        emit QuoteAssetSet(asset, label, allowed, minLiquidity);
    }

    /// @notice Only affects pools launched after the change.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        launchFee = fee;
        emit LaunchFeeSet(fee);
    }

    function setMinNativeLiquidity(uint256 amount) external onlyOwner {
        minNativeLiquidity = amount;
        emit MinNativeLiquiditySet(amount);
    }
}
