# World History and Immutable Append-Only Ledger

World History records accepted canonical happened events and their provenance within a digital world. It operates as an **append-only, immutable** chronological ledger answering the question: "How did this world evolve into its present state?". It does not record ephemeral turns, private application state mutations, or operations outside canonical world admission.

In Nimi's architecture, append-only persistence provides transparency and verifiable provenance. Historical records cannot be silently rewritten or physically deleted; subsequent corrections are committed as explicit superseding events, preserving the full timeline.

## Core Properties of World History

| Dimension | Specification | Architectural Value |
| --- | --- | --- |
| **Storage Engine** | Realm Event Ledger (`R-WHIST-*`) | High-throughput ingestion, distributed time-series storage |
| **Mutability** | Strictly Append-Only | Eliminates timeline tampering and retrospective fabrication |
| **Execution Mode** | `REPLAY` (read-only) / `CANON_MUTATION` (append-enabled) | Isolates auditing and simulations from live canonical mutations |
| **Provenance Requirement** | Mandatory actor, time, and evidence metadata | Guarantees clear origin and causality for every committed event |
| **Correction Mechanism** | Explicit superseding and revocation markers | Preserves complete evolution history without destructive overwrites |

## Strict Isolation of Execution Modes

- **Replay Mode (`REPLAY`)**: Used for diagnostic replays, security audits, or narrative re-simulations. It sequentially processes historical events to derive state views; appending new events to the shared world history is strictly disabled, while state mutations are evaluated per the owner authorization matrix.
- **Canon Mutation (`CANON_MUTATION`)**: Production-level operations that advance world state and append new authoritative entries to the ledger.

This boundary ensures that auditors and developers can simulate past timelines without risking contamination of canonical history.

## Correction and Superseding Workflows

When creators or administrators need to correct previously submitted records, Realm enforces structured correction workflows:

1. **Superseding**: Appends a new event explicitly referencing the older record, providing corrected attributes and human-readable rationale.
2. **Revocation**: Appends an explicit revocation event marking the prior event as inactive for future state calculations.
3. **Preservation of Provenance**: The original record remains permanently preserved in the timeline. Auditors can always verify: "Event A occurred at T1, and was superseded at T2 by Event B due to reason X".

## Three Pillars of World Modeling

| Pillar | Fundamental Question | Representation |
| --- | --- | --- |
| **Authoritative Truth (`Truth`)** | What are the authoritative settings, rules, and core entities of this world? | Realm Truth contract (`R-TRUTH-*`), evolvable via authorized releases |
| **World State** | What does the world look like right now? | Present-time snapshot (`WorldState`) |
| **World History** | How did the world arrive here? | Append-only event ledger (`WorldHistory`) |

Together, these pillars create verifiable, explainable digital worlds.

## Related Documentation

- [World State Architecture](/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
