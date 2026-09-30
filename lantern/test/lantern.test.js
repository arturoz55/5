const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const U = (n) => ethers.parseUnits(String(n), 6); // USDG
const P = (n) => ethers.parseUnits(String(n), 8); // prices

describe("Lantern", function () {
  let owner, keeper, lp, alice, bob, usdg, oracle, ex;

  async function price(id, v) {
    await oracle.connect(keeper).push([id], [P(v)]);
  }

  beforeEach(async () => {
    [owner, keeper, lp, alice, bob] = await ethers.getSigners();
    usdg = await ethers.deployContract("MockUSDG");
    oracle = await ethers.deployContract("PriceOracle", [owner.address]);
    ex = await ethers.deployContract("LanternExchange", [owner.address, await usdg.getAddress(), await oracle.getAddress(), U(5)]);
    await oracle.setKeeper(keeper.address, true);
    await ex.addMarket("BABA", 10);
    await ex.addMarket("JD", 10);
    await price(0, 100);
    await price(1, 30);
    for (const s of [lp, alice, bob]) {
      await usdg.mint(s.address, U(1_000_000));
      await usdg.connect(s).approve(await ex.getAddress(), ethers.MaxUint256);
    }
    await ex.connect(lp).deposit(U(100_000));
  });

  async function invariant() {
    const bal = await usdg.balanceOf(await ex.getAddress());
    expect(bal).to.equal((await ex.vaultAssets()) + (await ex.totalMargin()));
  }

  it("opens a long, charges the fee and records the position", async () => {
    await ex.connect(alice).open(0, true, U(1000), 5);
    const fee = (U(1000) * 5n * 10n) / 10000n; // 0.1% of gross notional
    const [ids, list] = await ex.positionsOf(alice.address);
    expect(ids.length).to.equal(1);
    expect(list[0].margin).to.equal(U(1000) - fee);
    expect(list[0].size).to.equal((U(1000) - fee) * 5n);
    expect(list[0].entryPrice).to.equal(P(100));
    expect(await ex.vaultAssets()).to.equal(U(100_000) + fee);
    await invariant();
  });

  it("pays a profitable long out of the vault", async () => {
    await ex.connect(alice).open(0, true, U(1000), 10);
    const [ids, list] = await ex.positionsOf(alice.address);
    await price(0, 110); // +10% with 10x
    const [pnl] = await ex.positionValue(ids[0]);
    expect(pnl).to.equal(list[0].size / 10n);
    const before = await usdg.balanceOf(alice.address);
    await ex.connect(alice).close(ids[0]);
    const closeFee = (list[0].size * 10n) / 10000n;
    expect(await usdg.balanceOf(alice.address) - before).to.equal(list[0].margin + list[0].size / 10n - closeFee);
    await invariant();
  });

  it("a losing short pays the vault", async () => {
    await ex.connect(alice).open(1, false, U(1000), 4);
    const [ids] = await ex.positionsOf(alice.address);
    const vaultBefore = await ex.vaultAssets();
    await price(1, 33); // +10% against a short
    await ex.connect(alice).close(ids[0]);
    expect(await ex.vaultAssets()).to.be.gt(vaultBefore);
    await invariant();
  });

  it("liquidates below maintenance and rewards the liquidator", async () => {
    await ex.connect(alice).open(0, true, U(1000), 10);
    const [ids] = await ex.positionsOf(alice.address);
    const liq = await ex.liquidationPrice(ids[0]);
    expect(liq).to.be.gt(P(94)).and.lt(P(96));
    await price(0, 96);
    await expect(ex.connect(bob).liquidate(ids[0])).to.be.revertedWithCustomError(ex, "NotLiquidatable");
    await price(0, 94);
    const before = await usdg.balanceOf(bob.address);
    await expect(ex.connect(bob).liquidate(ids[0])).to.emit(ex, "Liquidated");
    expect(await usdg.balanceOf(bob.address)).to.be.gt(before);
    expect((await ex.positionsOf(alice.address))[0].length).to.equal(0);
    await invariant();
  });

  it("absorbs bad debt without breaking accounting", async () => {
    await ex.connect(alice).open(0, true, U(1000), 10);
    const [ids] = await ex.positionsOf(alice.address);
    for (const v of [85, 72]) await price(0, v); // gap far below zero equity
    await ex.connect(bob).liquidate(ids[0]);
    await invariant();
  });

  it("adding margin moves the liquidation price away", async () => {
    await ex.connect(alice).open(0, true, U(1000), 10);
    const [ids] = await ex.positionsOf(alice.address);
    const l1 = await ex.liquidationPrice(ids[0]);
    await ex.connect(alice).addMargin(ids[0], U(500));
    expect(await ex.liquidationPrice(ids[0])).to.be.lt(l1);
    await invariant();
  });

  it("enforces leverage, minimum margin, ownership and market switches", async () => {
    await expect(ex.connect(alice).open(0, true, U(100), 11)).to.be.revertedWithCustomError(ex, "BadLeverage");
    await expect(ex.connect(alice).open(0, true, U(100), 0)).to.be.revertedWithCustomError(ex, "BadLeverage");
    await expect(ex.connect(alice).open(0, true, U(1), 2)).to.be.revertedWithCustomError(ex, "MarginTooSmall");
    await expect(ex.connect(alice).open(9, true, U(100), 2)).to.be.revertedWithCustomError(ex, "BadMarket");
    await ex.connect(alice).open(0, true, U(100), 2);
    const [ids] = await ex.positionsOf(alice.address);
    await expect(ex.connect(bob).close(ids[0])).to.be.revertedWithCustomError(ex, "NotOwnerOfPosition");
    await ex.setMarket(0, 10, false);
    await expect(ex.connect(alice).open(0, true, U(100), 2)).to.be.revertedWithCustomError(ex, "MarketDisabled");
    await ex.connect(alice).close(ids[0]); // closing still works when disabled
    await expect(ex.connect(alice).setMarket(0, 10, true)).to.be.revertedWithCustomError(ex, "OwnableUnauthorizedAccount");
  });

  it("caps net exposure against the vault", async () => {
    // vault 100k, cap 50% => 50k net; 10x on 6k margin ~ 60k notional
    await expect(ex.connect(alice).open(0, true, U(6000), 10)).to.be.revertedWithCustomError(ex, "ExposureCap");
    // offsetting positions net out
    await ex.connect(alice).open(0, true, U(4000), 10);
    await ex.connect(bob).open(0, false, U(4000), 10);
    await ex.connect(alice).open(0, true, U(4000), 10);
  });

  it("refuses stale prices and oversized jumps", async () => {
    await expect(oracle.connect(keeper).push([0], [P(200)])).to.be.revertedWithCustomError(oracle, "MoveTooLarge");
    await expect(oracle.connect(alice).push([0], [P(100)])).to.be.revertedWithCustomError(oracle, "NotKeeper");
    await time.increase(3601);
    await expect(ex.connect(alice).open(0, true, U(100), 2)).to.be.revertedWithCustomError(oracle, "Stale");
  });

  it("vault shares use the collateral's decimals", async () => {
    expect(await ex.decimals()).to.equal(6);
    expect(await ex.balanceOf(lp.address)).to.equal(U(100_000)); // 1 LNV per USDG at the first deposit
  });

  it("vault shares track profit and block withdrawals that would uncover positions", async () => {
    await ex.connect(alice).open(0, false, U(1000), 10);
    const [ids] = await ex.positionsOf(alice.address);
    await price(0, 103); // short loses
    await ex.connect(alice).close(ids[0]);
    const shares = await ex.balanceOf(lp.address);
    expect(await ex.vaultAssets()).to.be.gt(U(100_000));
    // new position, then try to pull almost everything out
    await ex.connect(bob).open(0, true, U(2000), 10);
    await expect(ex.connect(lp).withdraw((shares * 99n) / 100n)).to.be.revertedWithCustomError(ex, "VaultInUse");
    const before = await usdg.balanceOf(lp.address);
    await ex.connect(lp).withdraw(shares / 10n);
    expect(await usdg.balanceOf(lp.address)).to.be.gt(before + U(10_000) - 1n);
    await invariant();
  });

  it("random trading keeps the books balanced", async () => {
    const traders = [alice, bob];
    let px = [100, 30];
    for (let i = 0; i < 30; i++) {
      const t = traders[i % 2];
      const m = i % 2;
      await ex.connect(t).open(m, i % 3 === 0, U(100 + i * 10), 1 + (i % 10));
      px[m] = Math.max(1, px[m] * (1 + (((i * 7) % 11) - 5) / 100));
      await price(m, px[m].toFixed(4));
      const [ids] = await ex.positionsOf(t.address);
      if (i % 4 === 0 && ids.length) {
        const [, , liq] = await ex.positionValue(ids[0]);
        if (liq) await ex.liquidate(ids[0]);
        else await ex.connect(t).close(ids[0]);
      }
    }
    await invariant();
  });
});
