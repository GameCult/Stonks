# Stonks Agent Notes

Stonks is a market data adapter daemon for the CultMesh Verse. It is not a
trading bot, portfolio manager, investment adviser, or renderer decoration.

## Authority Map

- Owner: Stonks owns public market data polling, normalization, provenance,
  freshness, request-event persistence, and its provider-owned Eve/CultUI
  surface.
- Inputs: Finnhub equity quotes, CoinGecko crypto prices, low-rate mention
  feeds used only for sampling priority, configured symbols/assets, local
  runtime configuration, and future provider-owned market data feeds.
- Outputs: `stonks.market_snapshot.v1`, `stonks.request_event.v1`,
  `gamecult.eve.surface_state.v1`, the `scratch/stonks/stonks-state.cc`
  CultCache document, `/eve/deck`, `/eve/deck/providers`, and `/health`.
- Derived state: Odin, Nightwing, Eve clients, dashboards, and agents consume
  Stonks projections; they do not own market truth or scrape markets directly.
- Forbidden writers: renderers, Odin, VoidBot rumination, and repo Faces must
  not invent market state. They consume the Stonks provider surface.
- Shared paths: HTTP status, Eve surface, and future CultMesh documents are all
  derived from the same normalized market snapshot and request-event state.
- Equity sampling: Finnhub is the equity authority. Mention feeds may move a
  configured symbol earlier in the quote schedule, but they do not publish
  prices or spend Finnhub budget. Stooq is no longer an active equity state
  owner.

Markets own prices. Stonks owns the adapter. Odin sees the Verse.
