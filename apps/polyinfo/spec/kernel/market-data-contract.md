# Market Data Contract — PI-DATA-*

> Upstream discovery, historical windows, realtime ingest, and price semantics.

## PI-DATA-001: Discovery Source Split

Polyinfo uses separate upstream paths for:

- market and event discovery
- historical window reconstruction
- realtime updates

The authoritative source inventory is `tables/external-api-surface.yaml`.

## PI-DATA-002: Event-First Discovery

For sector discovery, Polyinfo is event-first rather than market-list-first.

- v1 discovery starts from sector/tag-linked event fetches
- event responses may provide the associated market set
- app-local tracked markets derive from the discovered event set plus manual curation

## PI-DATA-003: Price Semantics Alignment

Visible probability in Polyinfo must align with Polymarket front-end semantics.

- the displayed price semantic mirrors Polymarket's own display logic
- Polyinfo must not silently substitute an incompatible local display formula
- any fallback or stale state must be made visible

This rule applies to user-facing probabilities and deltas, not to every internal raw field retained for debugging.

## PI-DATA-004: Arbitrary Window Reconstruction

Signal windows such as 48 hours must be reconstructed from historical price data rather than from fixed canned change fields alone.

Polyinfo may use upstream convenience fields for secondary display, but canonical signal construction for arbitrary windows must rely on historical price lookups.

## PI-DATA-005: Realtime Subscription Boundary

Realtime updates use the upstream market WebSocket path defined in `tables/external-api-surface.yaml`.

The realtime layer must:

- subscribe only after a concrete active market set exists
- use upstream identifiers required by the subscription surface
- maintain keepalive behavior required by the upstream service
- reconnect without inventing synthetic price changes

## PI-DATA-006: Upstream Liquidity and Volume Facts

Liquidity, volume, and related upstream market activity fields are canonical weighting inputs for Polyinfo.

They are not admission gates in v1.

- low-activity markets remain visible
- low-activity markets receive less analytical weight
- the weighting effect must be materially stronger than a minor linear penalty

## PI-DATA-007: Cache and Freshness Policy

Polyinfo must separate:

- upstream snapshot cache
- realtime transient state
- app-local canonical taxonomy and signal records

Cache staleness must be visible when upstream refresh or subscription health degrades.

## PI-DATA-008: Analysis Input Preparation

The data layer must prepare a structured evidence package for sector analysis.

That package must be able to include:

- current window deltas for tracked markets
- relevant activity and weight facts
- active narrative mappings
- active core-variable mappings
- sector-local context needed by the analyst session

The data layer prepares and constrains the input package, but it does not replace the analyst agent's role in producing the final conclusion.

## PI-DATA-009: No News Ingest

News, headlines, and social commentary must not enter the canonical market-data pipeline.

Polyinfo trusts market facts and app-local taxonomy only. Any future reference material would require a separate spec admission.
