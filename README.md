# Stonks

Stonks publishes market-data pulse into the GameCult CultMesh Verse.

It polls public equity/ETF and crypto endpoints, normalizes the result into
CultCache state, and exposes a provider-owned Eve/CultUI surface for Odin and
renderers such as Nightwing.

## Current Body

- Provider id: `stonks.market`
- Eve deck: `ws://127.0.0.1:8802/eve/deck`
- Provider manifest: `http://127.0.0.1:8802/eve/deck/providers`
- Health: `http://127.0.0.1:8802/health`
- Idunn daemon health: `idunn.daemon_health` over
  `cultnet.transport.rudp.v0`, defaulting to `127.0.0.1:17870` with daemon id
  `stonks` and contract `stonks.cultnet-rudp-market-health`.
- Snapshot: `http://127.0.0.1:8802/market/state`
- CultCache state: `scratch/stonks/stonks-state.cc`
- Provider records: the same CultCache store now contains
  `gamecult.eve.provider_advertisement.v1`, `stonks.command_boundary.v1`, and
  `stonks.transport_profile.v1` beside the market snapshot and Eve surface.
- Request events: persisted as keyed `stonks.request_event.v1` CultCache
  documents and summarized in the Eve dashboard. Raw request ledgers are not
  shown as dashboard truth.
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

- Equities/ETFs: Finnhub quote endpoint. Set `FINNHUB_API_KEY` or
  `STONKS_FINNHUB_TOKEN`; the daemon defaults to 48 quote calls/minute so it
  stays below the free-plan 60 calls/minute ceiling.
- Crypto: CoinGecko simple price endpoint.
- Mention radar: Hacker News Algolia search, IGN RSS, and Eurogamer RSS. These
  feeds steer which configured symbols Finnhub samples first; they do not own
  market state.

The daemon is for operator visibility and ambient market context. It is not
financial advice and does not place trades.

Configure defaults with:

```powershell
$env:FINNHUB_API_KEY="..."
$env:STONKS_EQUITY_CALLS_PER_MINUTE="48"
$env:STONKS_MENTION_REFRESH_MS="600000"
$env:STONKS_EQUITIES="ubi.fr,ea.us,ttwo.us,rblx.us,ntdoy.us,nvda.us,amd.us,tsla.us"
$env:STONKS_CRYPTO="bitcoin,ethereum,solana,dogecoin"
$env:STONKS_PRIVATE_WATCH="Musk Complex"
```

You can also put the Finnhub token in `finnhub-oauth.txt` at the repo root or
pass `--finnhubTokenFile`/`STONKS_FINNHUB_TOKEN_FILE`.

At the default 15 second poll interval and 48 calls/minute budget, Stonks pulls
up to 12 Finnhub equity quotes per refresh. It prioritizes recently mentioned
watch symbols, uncached symbols, and then a round-robin pass across the
configured watchlist.

Idunn health publishing is enabled by the launcher with:

```powershell
--idunn-rudp-health 127.0.0.1:17870
--idunn-daemon stonks
--idunn-health-contract stonks.cultnet-rudp-market-health
```

The `/health`, `/market/state`, and `/eve/deck` endpoints remain
compatibility/status or renderer projections. They are not the owners of Stonks
daemon liveness or provider truth once Idunn has fresh RUDP health and Odin can
read the typed provider records from `scratch/stonks/stonks-state.cc`.
