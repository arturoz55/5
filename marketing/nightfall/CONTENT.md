# Nightfall: kit de lanzamiento

- **Imágenes:** `marketing/nightfall/images/`
- **Vídeo:** `marketing/nightfall/video/nightfall-preview.mp4` (18 s, 1280×720)
- **Regenerar:** `node marketing/nightfall/src/render.js`

> **Importante:** Nightfall es una **plataforma**, no una moneda. El trading todavía no está activo; lo que está abierto es la **vista previa** (mercados, herramientas y conexión de billetera). Por eso los textos anuncian la vista previa y no prometen precios ni ganancias.
>
> Sustituye `nightfall.xyz` y `@nightfall` por tu dominio y tu usuario reales.

---

## Bio de Twitter/X (máx. 160 caracteres)

**EN** (150): `The night desk for China's giants. Long or short 8 US-listed Chinese stocks, 1–10×, margined in USDG. Preview open · trading at launch.`

**ES** (157): `La mesa nocturna de los gigantes chinos. Long o short en 8 acciones chinas de EE. UU., 1–10×, con margen en USDG. Vista previa abierta.`

- **Nombre:** `Nightfall`
- **Foto de perfil:** `images/nightfall-avatar.jpg`
- **Cabecera:** `images/nightfall-header.jpg`
- **Enlace:** `nightfall.xyz`

---

## Tweet de lanzamiento (adjunta el vídeo)

**EN**
```
Nightfall is here.

The night desk for China's giants:
→ 8 US-listed Chinese stocks, from BABA to NIO
→ long or short, 1× to 10×, margined in USDG
→ connect MetaMask, Phantom or Rabby

The preview is open today. Trading opens at launch.

nightfall.xyz
```

**ES**
```
Llega Nightfall.

La mesa nocturna de los gigantes chinos:
→ 8 acciones chinas cotizadas en EE. UU., de BABA a NIO
→ long o short, de 1× a 10×, con margen en USDG
→ conecta MetaMask, Phantom o Rabby

La vista previa abre hoy. El trading, en el lanzamiento.

nightfall.xyz
```

---

## Tweets

1. **[images/nightfall-markets.jpg]**
   ```
   Eight names. Two directions.

   BABA · PDD · JD · BIDU · NTES · BILI · LI · NIO

   New York prices China's biggest companies while Shanghai sleeps. Nightfall lets you take a side.
   ```

2. **[images/nightfall-how.jpg]**
   ```
   How a trade works on Nightfall:

   01 Post margin in USDG
   02 Pick long or short, 1× to 10×
   03 Close whenever you want, or get liquidated below 5% equity

   No hidden rules. The formulas are on the site.
   ```

3. **[images/nightfall-wallet.jpg]**
   ```
   Bring your own wallet.

   MetaMask, Phantom, Rabby, Coinbase Wallet: Nightfall detects what you have installed.

   We only ask for your address and network. Never your seed phrase. Never your keys.
   ```

4. **[images/nightfall-square.jpg]**
   ```
   Trade the night shift.

   When it's 3 a.m. in Shanghai, BABA and NIO are still moving in New York.
   ```

5. ```
   Plan it before you trade it.

   Nightfall's tools, free and in your browser:
   • PnL & liquidation calculator
   • risk-based position sizer
   • exchange clock (NY · HK · Shanghai)
   • correlation matrix
   • price alerts
   ```

6. ```
   The sky on Nightfall follows the market.

   Prices falling? It rains.
   Prices rising? The clouds break.
   A position gets liquidated? Lightning.

   Small detail. We like it.
   ```

7. ```
   Leverage cuts both ways.

   At 10×, a 10% move against you wipes out your margin. Nightfall shows your liquidation price before you open, and a "what if" slider to stress-test it.

   Trade what you can afford to lose.
   ```

8. ```
   Also on Nightfall: a Zcash corner.

   See what a block explorer learns from a transparent vs. a shielded payment, inspect any ZEC address, and scrub through the supply and halving schedule.
   ```

---

## Artículo

- **Título para Twitter (EN):** `Nightfall: trading China's giants while Shanghai sleeps`
- **Título para Twitter (ES):** `Nightfall: operar a los gigantes chinos mientras Shanghái duerme`

### Nightfall: trading China's giants while Shanghai sleeps

Some of the biggest companies in China (Alibaba, PDD, JD, Baidu, NetEase, Bilibili, Li Auto and NIO) are also listed in New York. That means their prices keep moving during US hours, when their home markets are closed and most of Asia is asleep.

**Nightfall** is built for that window. It is a trading desk where you can go long or short on these eight names with 1× to 10× leverage, using USDG as margin and settling on chain.

#### How it works

You post USDG as margin, pick a direction and choose your leverage. Opening costs 0.1% of the position size, and closing costs another 0.1%. Your profit or loss follows the price exactly:

- **Long:** size × (price − entry) ÷ entry
- **Short:** size × (entry − price) ÷ entry

If your equity drops below 5% of the position size, anyone can liquidate it. Nightfall shows your liquidation price before you trade, and a "what if" slider lets you test moves of up to 20% either way.

#### Who is on the other side

Every trade is matched against a shared liquidity vault. Liquidity providers deposit USDG and receive vault shares (NFV). The vault earns fees and traders' losses, and pays traders' profits. To keep it solvent, total one-sided exposure is capped at 50% of the vault.

#### Your wallet, your keys

Nightfall works with the wallets people already use: MetaMask, Phantom, Rabby, Coinbase Wallet and any wallet that follows the EIP-6963 standard. The site only asks for your address and network. Every transaction must be approved in your wallet.

#### Tools before trades

The preview already includes a set of free tools:

- PnL and liquidation calculator
- position sizer based on how much you are willing to lose
- live clock of the New York, Hong Kong and Shanghai sessions
- correlation matrix
- price alerts
- a small "up or down?" game

There's also a Zcash corner that explains, interactively, how shielded payments hide data while staying verifiable.

#### What is live today

The **preview** is open: markets (with simulated prices, clearly labelled), tools, and wallet connection. **Trading opens at launch**, once the contracts are deployed, a licensed price feed is connected and the code has been audited.

#### Read this first

Leverage magnifies losses as well as gains, and liquidations can happen fast when prices gap after a market closes. Positions are synthetic: you don't own the shares, and Nightfall is not affiliated with any of the companies listed. Leveraged products on equities are regulated in many countries. Check the rules where you live, and never trade money you can't afford to lose.

Night is falling. The desk is open.
