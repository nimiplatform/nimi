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
- optional prior sector discussion history when the current run is chat-continuous

No news, commentary, or unconstrained hidden external facts may enter the canonical analysis input package.

## PI-SIGNAL-002: Window Inventory

Supported windows are authoritative in `tables/signal-model.yaml`.

V1 must support at least:

- 24 hours
- 48 hours
- 7 days

Arbitrary future windows may be admitted later, but the above set is the minimum baseline.

## PI-SIGNAL-003: Narrative-First Analysis Order

Analysis runs must preserve this order:

1. market movement within a chosen window
2. narrative-level interpretation of grouped events and markets
3. core-variable-level interpretation across relevant narratives

Polyinfo must not jump directly from a raw market list to a top-level core-variable claim without preserving the intermediate narrative layer inside the analysis input package.

## PI-SIGNAL-004: Weighted Evidence

Analysis runs must reflect upstream activity asymmetry.

- high-volume and high-liquidity markets should dominate weak markets
- the weighting function must be strong enough that very small markets do not meaningfully overpower major markets
- weighting remains a soft rule rather than a hard exclusion rule

Detailed factor inventory is authoritative in `tables/signal-model.yaml`.

## PI-SIGNAL-005: LLM Analysis Role

Polyinfo's analytical conclusion is produced by the sector analyst LLM, not by a fixed deterministic labeler alone.

- the system prepares the structured evidence package
- prompt constraints define the required reasoning frame and forbidden evidence classes
- the LLM evaluates how the included events and markets affect narratives and core variables during the current run
- the LLM outputs the current analytical conclusion within the app's typed output surface

Rule-based preprocessing may derive deltas, ranking, and weights, but the final conclusion remains an LLM-run result.

## PI-SIGNAL-006: Signal Output Types

Signal outputs are authoritative in `tables/signal-model.yaml`.

V1 must support outputs that distinguish:

- strengthening
- weakening
- mixed or split
- low-confidence

The app may expose richer wording, but canonical output types remain typed rather than free-form only.

## PI-SIGNAL-007: Traceable Explanation

Every signal snapshot must preserve enough structure to explain:

- which events and markets were included
- which narratives were involved
- which core variables were evaluated
- which window was used
- how weighting affected the outcome
- which analyst prompt/profile version produced the conclusion

The user must be able to inspect this structure without relying on agent paraphrase.

## PI-SIGNAL-008: Snapshot Semantics

Signals are point-in-time analytical snapshots.

They must record:

- window
- evaluation timestamp
- active taxonomy version
- included event and market set
- typed output
- analyst-run conclusion
- analyst prompt/profile version

Later taxonomy edits must not silently rewrite historical signal records.
