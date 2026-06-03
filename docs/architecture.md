# Stonks Architecture

## Objective

Expose market price and volume pulse as a provider-owned CultMesh/Eve surface so
Odin can aggregate it and renderers can lower it without owning market state.

## Current Mechanism

```text
Public market endpoints
  -> Stonks poller
  -> request-event, market-snapshot, and Eve-surface CultCache documents
  -> normalized market snapshot with provenance, freshness, and request history
  -> provider-owned Eve/CultUI surface
  -> /eve/deck WebSocket + /eve/deck/providers manifest
  -> Odin interface ingestion
  -> Eve / Nightwing / agent projection
```

## Invariants

- Market sources own prices and volumes.
- Stonks owns polling, normalization, provenance, and surface publication.
- Stonks owns request-event persistence; Odin may publish request events on the
  marquee, but it does not create or mutate them.
- Odin owns discovery and aggregation, not market truth.
- Renderers lower the Stonks surface only.
- Stonks does not trade, advise, custody funds, or infer portfolio intent.

## Future Cut

When a typed CultMesh market feed exists, replace public polling with provider
documents while preserving the same normalized snapshot and Eve surface.
