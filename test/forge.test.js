const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));
const ZERO = ethers.ZeroAddress;
const far = () => Math.floor(Date.now() / 1000) + 10_000_000;

describe("Tensorforge", function () {
  let owner, treasury, alice, bob, factory, alpha;

  beforeEach(async () => {
    [owner, treasury, alice, bob] = await ethers.getSigners();
    factory = await ethers.deployContract("ForgeFactory", [owner.address, treasury.address, E("0.1")]);
    alpha = await ethers.deployContract("MockAlpha", ["Wrapped SN10 Alpha", "wSN10"]);
  });

  async function launchNative(signer = alice, quoteAmount = E(10), supply = E(1_000_000_000)) {
    const tx = await factory.connect(signer).createLaunch(
      { name: "Signal", symbol: "SIG", supply, metadata: '{"sector":"agents"}', quote: ZERO, quoteAmount },
      { value: quoteAmount + (await factory.launchFee()) }
    );
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "LaunchCreated");
    return {
      token: await ethers.getContractAt("ForgeToken", ev.args.token),
      pool: await ethers.getContractAt("ForgePool", ev.args.pool),
      id: ev.args.id,
    };
  }

  describe("launch", () => {
    it("mints the full supply into a locked pool funded with TAO", async () => {
      const { token, pool } = await launchNative();
      expect(await token.totalSupply()).to.equal(E(1_000_000_000));
      expect(await token.balanceOf(await pool.getAddress())).to.equal(E(1_000_000_000));
      expect(await token.balanceOf(alice.address)).to.equal(0);
      expect(await pool.reserveQuote()).to.equal(E(10));
      expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(E(10));
      expect(await token.creator()).to.equal(alice.address);
      expect(await token.metadataURI()).to.equal('{"sector":"agents"}');
    });

    it("indexes launches newest first", async () => {
      await launchNative(alice);
      await launchNative(bob);
      expect(await factory.launchCount()).to.equal(2);
      const page = await factory.getLaunches(0, 10);
      expect(page.length).to.equal(2);
      expect(page[0].creator).to.equal(bob.address);
      expect(page[1].creator).to.equal(alice.address);
      expect((await factory.getLaunches(1, 10)).length).to.equal(1);
      expect((await factory.getLaunches(5, 10)).length).to.equal(0);
      expect(await factory.launchIdsOf(alice.address)).to.deep.equal([0n]);
      const [id, v] = await factory.getLaunchByToken(page[0].token);
      expect(id).to.equal(1n);
      expect(v.symbol).to.equal("SIG");
      await expect(factory.getLaunchByToken(alice.address)).to.be.revertedWith("unknown token");
    });

    it("validates parameters", async () => {
      const base = { name: "A", symbol: "A", supply: E(1), metadata: "", quote: ZERO, quoteAmount: E(1) };
      await expect(factory.createLaunch({ ...base, name: "" }, { value: E(1) })).to.be.revertedWithCustomError(factory, "BadName");
      await expect(factory.createLaunch({ ...base, symbol: "X".repeat(13) }, { value: E(1) })).to.be.revertedWithCustomError(factory, "BadName");
      await expect(factory.createLaunch({ ...base, supply: 1 }, { value: E(1) })).to.be.revertedWithCustomError(factory, "BadSupply");
      await expect(factory.createLaunch({ ...base, metadata: "x".repeat(2049) }, { value: E(1) })).to.be.revertedWithCustomError(factory, "MetadataTooLong");
      await expect(factory.createLaunch({ ...base, quoteAmount: E("0.01") }, { value: E("0.01") })).to.be.revertedWithCustomError(factory, "LiquidityTooLow");
      await expect(factory.createLaunch(base, { value: E(2) })).to.be.revertedWithCustomError(factory, "BadValue");
      await expect(factory.createLaunch({ ...base, quote: await alpha.getAddress() })).to.be.revertedWithCustomError(factory, "QuoteNotAllowed");
    });

    it("charges the launch fee to the treasury", async () => {
      await factory.setLaunchFee(E(1));
      const before = await ethers.provider.getBalance(treasury.address);
      await launchNative();
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(before + E(1));
    });

    it("pool cannot be re-initialized and rejects stray TAO", async () => {
      const { pool, token } = await launchNative();
      await expect(pool.initialize(await token.getAddress())).to.be.revertedWithCustomError(pool, "NotFactory");
      await expect(alice.sendTransaction({ to: await pool.getAddress(), value: 1 })).to.be.reverted;
    });

    it("only the owner can administer", async () => {
      await expect(factory.connect(alice).setLaunchFee(1)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      await expect(factory.connect(alice).setQuoteAsset(await alpha.getAddress(), "x", true, 0)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      await expect(factory.setTreasury(ZERO)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  describe("trading (native TAO)", () => {
    it("buys at the quoted amount and pays the protocol fee", async () => {
      const { token, pool } = await launchNative();
      const quoted = await pool.quoteBuy(E(1));
      const tBefore = await ethers.provider.getBalance(treasury.address);
      await expect(pool.connect(bob).buy(quoted, bob.address, far(), { value: E(1) }))
        .to.emit(pool, "Swap");
      expect(await token.balanceOf(bob.address)).to.equal(quoted);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(tBefore + E("0.005"));
      // pool TAO balance always equals tracked reserve
      expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(await pool.reserveQuote());
    });

    it("sells back for less than paid (fees) and keeps reserves consistent", async () => {
      const { token, pool } = await launchNative();
      await pool.connect(bob).buy(0, bob.address, far(), { value: E(1) });
      const bal = await token.balanceOf(bob.address);
      await token.connect(bob).approve(await pool.getAddress(), bal);
      const quoted = await pool.quoteSell(bal);
      const before = await ethers.provider.getBalance(bob.address);
      const rc = await (await pool.connect(bob).sell(bal, quoted, bob.address, far())).wait();
      const gas = rc.gasUsed * rc.gasPrice;
      const after = await ethers.provider.getBalance(bob.address);
      expect(after - before + gas).to.equal(quoted);
      expect(quoted).to.be.lt(E(1));
      expect(quoted).to.be.gt(E("0.97"));
      expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(await pool.reserveQuote());
      expect(await token.balanceOf(await pool.getAddress())).to.equal(await pool.reserveToken());
      // locked liquidity grew from retained fees
      expect(await pool.reserveQuote()).to.be.gt(E(10));
    });

    it("k never decreases across trades", async () => {
      const { token, pool } = await launchNative();
      let k = (await pool.reserveQuote()) * (await pool.reserveToken());
      for (let i = 0; i < 5; i++) {
        await pool.connect(bob).buy(0, bob.address, far(), { value: E(i + 1) });
        const k2 = (await pool.reserveQuote()) * (await pool.reserveToken());
        expect(k2).to.be.gte(k); k = k2;
        const half = (await token.balanceOf(bob.address)) / 2n;
        await token.connect(bob).approve(await pool.getAddress(), half);
        await pool.connect(bob).sell(half, 0, bob.address, far());
        const k3 = (await pool.reserveQuote()) * (await pool.reserveToken());
        expect(k3).to.be.gte(k); k = k3;
      }
    });

    it("enforces slippage, deadline, asset and zero checks", async () => {
      const { pool, token } = await launchNative();
      const q = await pool.quoteBuy(E(1));
      await expect(pool.connect(bob).buy(q + 1n, bob.address, far(), { value: E(1) })).to.be.revertedWithCustomError(pool, "Slippage");
      const now = await time.latest();
      await expect(pool.connect(bob).buy(0, bob.address, now - 1, { value: E(1) })).to.be.revertedWithCustomError(pool, "Expired");
      await expect(pool.connect(bob).buy(0, bob.address, far(), { value: 0 })).to.be.revertedWithCustomError(pool, "ZeroAmount");
      await expect(pool.connect(bob).buyWithQuote(1, 0, bob.address, far())).to.be.revertedWithCustomError(pool, "WrongAsset");
      await expect(pool.connect(bob).sell(0, 0, bob.address, far())).to.be.revertedWithCustomError(pool, "ZeroAmount");
      await pool.connect(bob).buy(0, bob.address, far(), { value: E(1) });
      const bal = await token.balanceOf(bob.address);
      await token.connect(bob).approve(await pool.getAddress(), bal);
      const qs = await pool.quoteSell(bal);
      await expect(pool.connect(bob).sell(bal, qs + 1n, bob.address, far())).to.be.revertedWithCustomError(pool, "Slippage");
    });

    it("can never drain the token reserve", async () => {
      const { pool } = await launchNative(alice, E(1), E(1000));
      await pool.connect(bob).buy(0, bob.address, far(), { value: E(9000) });
      expect(await pool.reserveToken()).to.be.gt(0);
    });
  });

  describe("trading (subnet-alpha reserve)", () => {
    it("launches and trades against an allow-listed ERC-20", async () => {
      const a = await alpha.getAddress();
      await factory.setQuoteAsset(a, "SN10 alpha", true, E(5));
      expect((await factory.quoteAssets())[0].label).to.equal("SN10 alpha");
      await alpha.mint(alice.address, E(100));
      await alpha.mint(bob.address, E(100));
      await alpha.connect(alice).approve(await factory.getAddress(), E(50));

      await expect(factory.connect(alice).createLaunch({ name: "Alpha Kid", symbol: "AK", supply: E(1e6), metadata: "", quote: a, quoteAmount: E(1) }))
        .to.be.revertedWithCustomError(factory, "LiquidityTooLow");
      await expect(factory.connect(alice).createLaunch({ name: "Alpha Kid", symbol: "AK", supply: E(1e6), metadata: "", quote: a, quoteAmount: E(50) }, { value: 1 }))
        .to.be.revertedWithCustomError(factory, "BadValue");
      await factory.connect(alice).createLaunch({ name: "Alpha Kid", symbol: "AK", supply: E(1e6), metadata: "", quote: a, quoteAmount: E(50) });

      const v = (await factory.getLaunches(0, 1))[0];
      const pool = await ethers.getContractAt("ForgePool", v.pool);
      const token = await ethers.getContractAt("ForgeToken", v.token);
      expect(v.reserveQuote).to.equal(E(50));
      await expect(pool.connect(bob).buy(0, bob.address, far(), { value: 1 })).to.be.revertedWithCustomError(pool, "WrongAsset");

      await alpha.connect(bob).approve(v.pool, E(10));
      const q = await pool.quoteBuy(E(10));
      await pool.connect(bob).buyWithQuote(E(10), q, bob.address, far());
      expect(await token.balanceOf(bob.address)).to.equal(q);
      expect(await alpha.balanceOf(treasury.address)).to.equal(E("0.05"));

      await token.connect(bob).approve(v.pool, q);
      await pool.connect(bob).sell(q, 0, bob.address, far());
      expect(await alpha.balanceOf(v.pool)).to.equal(await pool.reserveQuote());
    });
  });
});
