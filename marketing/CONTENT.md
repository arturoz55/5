# Tensorforge — kit de lanzamiento

Imágenes en `marketing/images/`, vídeo en `marketing/video/tensorforge-launch.mp4` (16 s, 1280×720).
Se regeneran con `node marketing/src/render.js`.

> Nota: los textos no prometen precios ni ganancias. En cripto eso es lo que genera confianza
> (y evita problemas legales). Sustituye `tensorforge.xyz` y `@tensorforge` por tu dominio y tu usuario reales.

---

## Bio de Twitter/X (≤160 caracteres)

**EN** (148): `Launch a token paired with TAO in one transaction. Liquidity locked forever, zero creator allocation. Built on Bittensor EVM. τ`

**ES** (150): `Lanza un token emparejado con TAO en una sola transacción. Liquidez bloqueada para siempre, sin reparto al creador. Sobre Bittensor EVM. τ`

- Nombre: `Tensorforge τ`
- Foto de perfil: `images/tensorforge-avatar.png`
- Cabecera: `images/tensorforge-header.png`
- Enlace: `tensorforge.xyz`

---

## Tweet de lanzamiento (con el vídeo adjunto)

**EN**
```
Tensorforge is live. τ

Strike a token. Temper it in TAO.

→ Name it, seed it with TAO or subnet alpha, launch — one transaction
→ 100% of supply goes into the pool, 0% to the creator
→ Liquidity is locked forever. No LP tokens, no withdraw function

tensorforge.xyz
```

**ES**
```
Tensorforge ya está en vivo. τ

Forja un token. Témplalo en TAO.

→ Ponle nombre, siémbralo con TAO o alpha de subnet y lánzalo: una sola transacción
→ El 100% del suministro va al pool, 0% al creador
→ Liquidez bloqueada para siempre. Sin LP tokens, sin función de retiro

tensorforge.xyz
```

---

## Tweets (con imagen sugerida)

1. **[images/tensorforge-how.png]**
   
   ```
   Three strikes, one transaction:

   01 Name it: ticker, supply, thesis
   02 Seed it: deposit TAO or subnet alpha, which sets the price
   03 Lock it: the pool is sealed forever

   That's the whole launch.
   ```

2. **[images/tensorforge-lock.png]**
   
   ```
   "Locked liquidity" usually means "trust me."

   On Tensorforge it means the pool contract has no withdraw function and no LP tokens. Nobody can pull it. Not the creator, not us.

   Read the code, don't trust the thread.
   ```

3. **[images/tensorforge-alpha.png]**
   
   ```
   τ or α?

   Pair your token with native TAO for the widest audience, or with a subnet's alpha to tie your market to that subnet's economy.

   You pick the floor.
   ```

4. 
   ```
   Every token on Tensorforge starts the same way: the creator holds 0.

   Want a bag? Buy it on the same curve as everyone else.
   ```

5. 
   ```
   Have a subnet idea but no netuid yet?

   Launch a Subnet Candidate: share your thesis, build in public, and let a market form before you register.
   ```

6. 
   ```
   Fees, plainly:

   • 1% per trade
   • 0.5% to the protocol
   • 0.5% stays in the pool, deepening locked liquidity

   No hidden taxes in the token. It's a plain ERC-20.
   ```

7. 
   ```
   Want to try it without risking anything?

   Switch to the Demo network on tensorforge.xyz: a funded demo wallet, real contract math, zero real funds.
   ```

8. 
   ```
   Reminder: anyone can launch anything. A "Subnet Coin" label doesn't mean the subnet team endorses it.

   Check the creator, read the description, never trade more than you can lose.
   ```

---

## Artículo

**Título para Twitter (EN):** `Strike a token, temper it in TAO: introducing Tensorforge`
**Título para Twitter (ES):** `Forja un token, témplalo en TAO: presentamos Tensorforge`

### Strike a token, temper it in TAO: introducing Tensorforge

Bittensor has become one of the most interesting places in crypto: dozens of subnets competing
to produce useful intelligence, each with its own community and its own convictions. What it hasn't
had is a simple, honest way for those communities to give an idea its own market.

**Tensorforge** is that tool. It's a token launchpad on Bittensor EVM where every market is paired
with TAO, or with a supported subnet's alpha, and every pool is locked from the moment it exists.

#### One transaction, three steps

1. **Name it.** Pick a name, a ticker, a supply and write your thesis. If it's a community coin for an
   existing subnet, tag its netuid. If it's a subnet that doesn't exist yet, launch it as a *candidate*.
2. **Seed it.** Deposit TAO or subnet alpha. That deposit, divided by the supply, is your starting price.
3. **Lock it.** The factory deploys your token, mints 100% of the supply straight into a fresh pool,
   adds your deposit and opens trading. All of it in a single transaction.

#### What "locked" actually means

Most launchpads ask you to trust that liquidity is locked. On Tensorforge the pool contract simply has
no way to give it back: there are no LP tokens and no withdraw function. The initial deposit, plus half
of every trading fee, stays in the pool for as long as the chain exists.

The token itself is a plain ERC-20. No owner, no mint function, no pause, no blacklist, no transfer tax.
The creator starts with **zero** tokens; if they want a position, they buy it on the same curve as everyone else.

#### TAO or alpha: you pick the floor

A market is only as meaningful as what it trades against. Pair with **native TAO** for the widest audience
and the simplest experience, since trades and gas use the same asset. Or pair with a **subnet's alpha**
through an allow-listed wrapper, so your market moves together with the subnet you believe in.

#### Fees, plainly

Each trade pays 1% on the TAO/alpha side: 0.5% goes to the protocol, and 0.5% stays in the pool,
permanently deepening liquidity. No other taxes exist.

#### Try it with no risk

Tensorforge ships with a **demo network** that runs entirely in your browser using exactly the same
math as the contracts. You get a funded demo wallet, so you can launch, buy and sell before using real TAO.

#### Read this before you trade

Anyone can launch anything. A "Subnet Coin" label or a netuid tag doesn't mean a subnet team endorses a token.
Locked liquidity stops the pool from being pulled; it doesn't stop the price from falling. The contracts are
small, open source and tested, but have not yet been formally audited. Never trade more than you can afford to lose.

The forge is lit. Your move. τ
