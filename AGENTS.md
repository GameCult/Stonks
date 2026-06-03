# Stonks Agent Notes

Stonks is a market data adapter daemon for the CultMesh Verse. It is not a
trading bot, portfolio manager, investment adviser, or renderer decoration.

## Authority Map

- Owner: Stonks owns public market data polling, normalization, provenance,
  freshness, its provider-owned Eve/CultUI surface, and local snapshot logs.
- Inputs: public market data endpoints, configured symbols/assets, local
  runtime configuration, and future provider-owned market data feeds.
- Outputs: `stonks.market_snapshot.v1`, `gamecult.eve.surface_state.v1`,
  `/eve/deck`, `/eve/deck/providers`, `/health`, and ignored scratch snapshots
  under `scratch/stonks/`.
- Derived state: Odin, Nightwing, Eve clients, dashboards, and agents consume
  Stonks projections; they do not own market truth or scrape markets directly.
- Forbidden writers: renderers, Odin, VoidBot rumination, and repo Faces must
  not invent market state. They consume the Stonks provider surface.
- Shared paths: HTTP status, Eve surface, and future CultMesh documents are all
  derived from the same normalized market snapshot.

Markets own prices. Stonks owns the adapter. Odin sees the Verse.

