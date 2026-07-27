# Knowledge UI

## Status: Admitted Contract; Desktop-Owned Surface

The Desktop knowledge UI contract
(`desktop/kernel/knowledge-ui-contract.md`) is admitted at the kernel
level. The user-facing browse + curation surface is Desktop-owned.

## What This UI Is

The Desktop Knowledge UI is the **user-facing surface** for browsing
and curating cognition knowledge bases — listing, searching,
adding entries, organizing, archiving.

It is the consumer of cognition's knowledge service (see
[Cognition → Memory + Knowledge Composition](/cognition/memory-knowledge-composition)),
not its owner.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| User-facing browse + curation UX | Knowledge service contract (Cognition) |
| Per-knowledge-base UI scopes | Cross-base authorization (Cognition) |
| Curation flow UI | Curation admission rules (Cognition) |

The UI consumes the knowledge service through admitted runtime
bridge. It does not invent knowledge structure.

## Reader Scenario: User Adds A Knowledge Entry

1. **User opens knowledge base in UI.** Per-base scope honored.
2. **User adds entry.** Curation UI captures content + metadata.
3. **Submission via admitted flow.** Cognition knowledge service
   admits the entry per its contract.
4. **Future agent retrievals see the new entry.**

## Reader Scenario: User Archives An Entry

1. **User selects archive.** Desktop UI requests cognition
   knowledge service archive.
2. **Refgraph blockers consulted.** If the entry has strong
   incoming refs, archive may block with explainability (see
   [Reference Graph](/cognition/reference-graph)).
3. **User decides.** Either resolve dependents first or accept
   broken-dependency evidence.
4. **Archive completes.** Per cognition cleanup semantics.

## What Knowledge UI Does Not Do

- It does not own knowledge service semantics.
- It does not let the UI invent its own retrieval surface that
  bypasses cognition.
- It does not let entries enter without curation admission.
- It does not bypass refgraph blockers on archive / remove.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
