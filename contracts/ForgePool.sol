// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ForgePool
/// @notice Constant-product (x * y = k) market between one launched token and one reserve asset.
///         The reserve asset is either native TAO (`quote == address(0)`) or an allow-listed
///         ERC-20 such as a subnet-alpha wrapper.
///
///         Liquidity is supplied once by the factory at launch and can never be withdrawn:
///         there are no LP shares and no remove function, so the initial pool is locked forever.
///
///         A 1% fee is charged on the reserve-asset side of every trade. Half of it goes to the
///         protocol treasury, the other half stays in the pool and deepens locked liquidity.
contract ForgePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 100; // 1.00% total
    uint256 public constant PROTOCOL_FEE_BPS = 50; // 0.50% of that goes to the treasury
    uint256 private constant BPS = 10_000;

    address public immutable factory;
    address public immutable quote; // address(0) = native TAO
    address public immutable treasury;

    address public token;
    uint256 public reserveToken;
    uint256 public reserveQuote;
    uint64 public createdAt;

    event Initialized(address indexed token, uint256 reserveToken, uint256 reserveQuote);
    event Swap(
        address indexed trader,
        address indexed to,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 reserveQuote,
        uint256 reserveToken
    );

    error NotFactory();
    error AlreadyInitialized();
    error NotInitialized();
    error Expired();
    error ZeroAmount();
    error Slippage(uint256 out, uint256 minOut);
    error WrongAsset();
    error InsufficientLiquidity();
    error TransferFailed();

    constructor(address quote_, address treasury_) {
        factory = msg.sender;
        quote = quote_;
        treasury = treasury_;
    }

    modifier live(uint256 deadline) {
        if (token == address(0)) revert NotInitialized();
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    /// @notice Called exactly once by the factory after the token has minted its supply here and
    ///         the reserve asset has been deposited (native TAO arrives as msg.value).
    function initialize(address token_) external payable {
        if (msg.sender != factory) revert NotFactory();
        if (token != address(0)) revert AlreadyInitialized();
        if (quote != address(0) && msg.value != 0) revert WrongAsset();
        token = token_;
        createdAt = uint64(block.timestamp);
        reserveToken = IERC20(token_).balanceOf(address(this));
        reserveQuote = quote == address(0) ? address(this).balance : IERC20(quote).balanceOf(address(this));
        if (reserveToken == 0 || reserveQuote == 0) revert InsufficientLiquidity();
        emit Initialized(token_, reserveToken, reserveQuote);
    }

    // ───────────────────────────── quotes ─────────────────────────────

    /// @notice Tokens received for `quoteIn` of the reserve asset.
    function quoteBuy(uint256 quoteIn) public view returns (uint256 tokensOut) {
        uint256 net = quoteIn - (quoteIn * FEE_BPS) / BPS;
        tokensOut = (net * reserveToken) / (reserveQuote + net);
    }

    /// @notice Reserve asset received for selling `tokensIn`.
    function quoteSell(uint256 tokensIn) public view returns (uint256 quoteOut) {
        uint256 gross = (tokensIn * reserveQuote) / (reserveToken + tokensIn);
        quoteOut = gross - (gross * FEE_BPS) / BPS;
    }

    /// @notice Spot price of one whole token (1e18 units) in reserve-asset wei.
    function spotPrice() external view returns (uint256) {
        if (reserveToken == 0) return 0;
        return (reserveQuote * 1e18) / reserveToken;
    }

    // ───────────────────────────── trading ─────────────────────────────

    /// @notice Buy with native TAO.
    function buy(uint256 minOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        live(deadline)
        returns (uint256 out)
    {
        if (quote != address(0)) revert WrongAsset();
        out = _buy(msg.value, minOut, to);
    }

    /// @notice Buy with the pool's ERC-20 reserve asset. Requires prior approval.
    function buyWithQuote(uint256 quoteIn, uint256 minOut, address to, uint256 deadline)
        external
        nonReentrant
        live(deadline)
        returns (uint256 out)
    {
        if (quote == address(0)) revert WrongAsset();
        uint256 before = IERC20(quote).balanceOf(address(this));
        IERC20(quote).safeTransferFrom(msg.sender, address(this), quoteIn);
        out = _buy(IERC20(quote).balanceOf(address(this)) - before, minOut, to);
    }

    /// @notice Sell tokens for the reserve asset. Requires prior approval of `token`.
    function sell(uint256 tokensIn, uint256 minOut, address to, uint256 deadline)
        external
        nonReentrant
        live(deadline)
        returns (uint256 out)
    {
        if (tokensIn == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;

        uint256 gross = (received * reserveQuote) / (reserveToken + received);
        uint256 fee = (gross * FEE_BPS) / BPS;
        uint256 protocolFee = (gross * PROTOCOL_FEE_BPS) / BPS;
        out = gross - fee;
        if (out == 0) revert ZeroAmount();
        if (out < minOut) revert Slippage(out, minOut);

        reserveToken += received;
        // the non-protocol part of the fee stays in the pool
        reserveQuote -= (out + protocolFee);

        emit Swap(msg.sender, to, false, out, received, reserveQuote, reserveToken);
        _payQuote(to, out);
        _payQuote(treasury, protocolFee);
    }

    function _buy(uint256 quoteIn, uint256 minOut, address to) private returns (uint256 out) {
        if (quoteIn == 0) revert ZeroAmount();
        uint256 fee = (quoteIn * FEE_BPS) / BPS;
        uint256 protocolFee = (quoteIn * PROTOCOL_FEE_BPS) / BPS;
        uint256 net = quoteIn - fee;
        out = (net * reserveToken) / (reserveQuote + net);
        if (out == 0) revert ZeroAmount();
        if (out >= reserveToken) revert InsufficientLiquidity();
        if (out < minOut) revert Slippage(out, minOut);

        reserveToken -= out;
        reserveQuote += quoteIn - protocolFee;

        emit Swap(msg.sender, to, true, quoteIn, out, reserveQuote, reserveToken);
        IERC20(token).safeTransfer(to, out);
        _payQuote(treasury, protocolFee);
    }

    function _payQuote(address to, uint256 amount) private {
        if (amount == 0) return;
        if (quote == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(quote).safeTransfer(to, amount);
        }
    }
}
