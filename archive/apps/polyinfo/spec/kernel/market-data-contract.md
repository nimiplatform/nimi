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

- current discovery starts from sector/tag-linked event fetches
- event responses provide the associated market set used by the workspace
- app-local analysis derives from the discovered event set plus the current sector structure

## PI-DATA-002A: Front-End Taxonomy Source

Polyinfo sector discovery follows Polymarket's own front-end taxonomy rather than the raw gamma tag catalog alone.

- root sector candidates come from the Polymarket homepage navigation surface
- child category candidates come from the Polymarket front-end filtered-tag surface for a selected root slug
- raw gamma tags are not the primary user-facing sector directory

## PI-DATA-002B: Full Event-Set Reconstruction

For a selected front-end category slug, Polyinfo reconstructs the event set by paginating the keyset event endpoint.

- the canonical fetch shape is `tag_slug=<categorySlug>`, `closed=false`, `order=volume_24hr`, `ascending=false`
- pagination continues through `after_cursor`
- the current app uses the fetched event set as workspace inventory while still retaining Polymarket front-end counts for navigation display

## PI-DATA-002C: Custom-Sector URL Import

Custom sectors may import upstream events by Polymarket URL.

- import resolves a concrete upstream event slug
- import caches event title, options, and source metadata locally
- import does not prefetch history windows by default
- import is only admitted for custom sectors

## PI-DATA-003: Price Semantics Alignment

Visible probability in Polyinfo must align with Polymarket front-end semantics.

- the displayed price semantic uses midpoint price when both bid and ask are available
- wide-spread states may fall back to last trade price
- if no bid / ask / last trade is available, the app may fall back to upstream outcome price cache
- Polyinfo must not silently substitute an incompatible local display formula
- any fallback or stale state must be made visible

## PI-DATA-004: Arbitrary Window Reconstruction

Signal windows such as 24 hours, 48 hours, and 7 days are reconstructed from historical price data rather than from fixed canned change fields alone.

Polyinfo may use upstream convenience fields for secondary display, but canonical analysis windows rely on historical price lookups.

## PI-DATA-005: Realtime Subscription Boundary

Realtime updates use the upstream market WebSocket path defined in `tables/external-api-surface.yaml`.

The realtime layer must:

- subscribe only after a concrete active market set exists and the user has requested price loading
- use upstream identifiers required by the subscription surface
- maintain keepalive behavior required by the upstream service
- reconnect without inventing synthetic price changes

## PI-DATA-006: Upstream Liquidity and Volume Facts

Liquidity, volume, and related upstream market activity fields are canonical weighting inputs for Polyinfo.

They are not admission gates in the current app.

- low-activity markets remain visible
- the current app computes a coarse `lead` / `support` / `watch` tier from sorted market volume
- raw activity facts such as `volume24hr`, `liquidity`, and `spread` are passed through to the analyst for final interpretation

## PI-DATA-007: Cache and Freshness Policy

Polyinfo must separate:

- upstream snapshot cache
- realtime transient state
- app-local canonical taxonomy and signal records
- custom-sector imported event cache

For imported custom-sector events:

- upstream validity should be refreshed when the custom sector is opened
- stale, closed, or missing events should remain visible until user deletion
- heavy history requests should remain on-demand rather than tied to import itself

In the current app, freshness is surfaced mainly through imported-event stale states, workspace connection labels, and explicit load / refresh actions rather than a separate dedicated freshness dashboard.

## PI-DATA-008: Analysis Input Preparation

The data layer must prepare a structured evidence package for sector analysis.

That package must be able to include:

- current window deltas for included events and markets
- relevant activity and weight facts
- active narratives
- active core variables
- sector-local context needed by the analyst session

The data layer prepares and constrains the input package, but it does not replace the analyst agent's role in producing the final conclusion. Event-to-taxonomy relationships are inferred on the fly for the package and are not promoted into separate persisted mapping objects.

## PI-DATA-009: No News Ingest

News, headlines, and social commentary must not enter the canonical market-data pipeline.

Polyinfo trusts market facts and app-local taxonomy only. Any future reference material would require a separate spec admission.
