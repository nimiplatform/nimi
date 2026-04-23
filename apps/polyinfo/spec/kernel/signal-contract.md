# Signal Contract — PI-SIGNAL-*

> Analysis input packaging, weighting, LLM-run conclusion generation, and output semantics.

## PI-SIGNAL-001: Analysis Input Package

Every analysis run must be built from a structured input package.

Canonical inputs are limited to:

- event and market probabilities over a chosen window
- upstream liquidity and volume facts
- sector-local narratives
- sector-local core variables
- active sector context
- optional prior sector conversation transcript when the current run is chat-continuous

No news, commentary, or unconstrained hidden external facts may enter the canonical analysis input package.

## PI-SIGNAL-002: Window Inventory

Supported windows are authoritative in `tables/signal-model.yaml`.

The current app supports:

- 24 hours
- 48 hours
- 7 days

## PI-SIGNAL-003: Narrative-First Analysis Order

Analysis runs must preserve this order:

1. market movement within a chosen window
2. narrative-level interpretation of grouped events and markets
3. core-variable-level interpretation across relevant narratives

The current app preserves this order by packaging raw market movement together with on-the-fly narrative and core-variable associations derived from the current sector taxonomy. Polyinfo must not jump directly from a raw market list to a top-level core-variable claim without that intermediate narrative context being available to the analyst.

## PI-SIGNAL-004: Weighted Evidence

Analysis runs must reflect upstream activity asymmetry.

- the current app materializes a coarse `weightTier` from sorted market volume
- high-activity markets should dominate weak markets in the analyst's interpretation
- raw `volume`, `volume24hr`, `liquidity`, and `spread` facts remain visible to the analyst
- weighting remains a soft rule rather than a hard exclusion rule

Detailed factor inventory is authoritative in `tables/signal-model.yaml`.

## PI-SIGNAL-005: LLM Analysis Role

Polyinfo's analytical conclusion is produced by the sector analyst LLM, not by a fixed deterministic labeler alone.

- the system prepares the structured evidence package
- prompt constraints define the required reasoning frame and forbidden evidence classes
- the LLM evaluates how the included events and markets affect narratives and core variables during the current run
- the LLM outputs the current analytical conclusion in natural language inside the app

Rule-based preprocessing may derive deltas, ranking, and weight tiers, but the final conclusion remains an LLM-run result.

## PI-SIGNAL-006: Signal Output Types

Signal conclusion tones are authoritative in `tables/signal-model.yaml`.

The current app does not persist a separate typed output enum in snapshot storage. Instead:

- the analyst answer is stored as free text
- conclusion tones such as strengthening, weakening, mixed, or low-confidence guide the analyst wording
- lightweight snapshots bookmark that answer rather than normalizing it into a dedicated enum field

## PI-SIGNAL-007: Traceable Explanation

The current app keeps explanation context split across two surfaces:

- the live workspace, which shows the selected window, market cards, deltas, and current taxonomy
- the saved snapshot, which stores a lightweight bookmark to the resulting analyst message

Current snapshots therefore preserve:

- sector reference
- chosen window
- evaluation timestamp
- headline and summary extracted from the analyst answer
- message linkage back to the saved assistant turn

The current app does not yet persist a full durable explanation-trace payload.

## PI-SIGNAL-008: Snapshot Semantics

Signals are point-in-time analytical bookmarks to analyst output.

They currently record:

- window
- evaluation timestamp
- sector reference
- extracted headline
- extracted summary
- message id of the assistant answer

Later taxonomy edits do not rewrite the stored snapshot text, but the app does not currently persist full taxonomy-version metadata alongside the snapshot.
