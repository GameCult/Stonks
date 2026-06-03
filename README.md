# Stonks

Stonks publishes market-data pulse into the GameCult CultMesh Verse.

It polls public equity/ETF and crypto endpoints, normalizes the result, writes a
local scratch snapshot, and exposes a provider-owned Eve/CultUI surface for
Odin and renderers such as Nightwing.

## Current Body

- Provider id: `stonks.market`
- Eve deck: `ws://127.0.0.1:8802/eve/deck`
- Provider manifest: `http://127.0.0.1:8802/eve/deck/providers`
- Health: `http://127.0.0.1:8802/health`
- Snapshot: `http://127.0.0.1:8802/market/state`
- Scratch state: `scratch/stonks/`
- Default focus: gaming and tech public names such as Ubisoft, EA, Take-Two,
  Roblox, Nintendo, Sony, Microsoft, NVIDIA, AMD, Google, Meta, Apple, TSMC,
  Tesla, ASML, Corsair, Logitech, and Sea.
- Private watch names: `Musk Complex` is represented explicitly as mixed
  public/private exposure: TSLA is tracked through the public `TSLA.US` quote,
  while SpaceX, xAI/X, Neuralink, and Boring need provider-owned news,
  disclosure, or secondary-market feeds before Stonks treats their movement as
  data.

## Start

```powershell
.\scripts\start-stonks.ps1
```

## Data Sources

- Equities/ETFs: Stooq CSV quote endpoint.
- Crypto: CoinGecko simple price endpoint.

The daemon is for operator visibility and ambient market context. It is not
financial advice and does not place trades.

Configure defaults with:

```powershell
$env:STONKS_EQUITIES="ubi.fr,ea.us,ttwo.us,rblx.us,ntdoy.us,nvda.us,amd.us,tsla.us"
$env:STONKS_CRYPTO="bitcoin,ethereum,solana,dogecoin"
$env:STONKS_PRIVATE_WATCH="Musk Complex"
```
