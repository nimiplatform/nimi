# Realm Interop Mapping

> Domain: Realm / Interop

## 0. Normative Imports

- `kernel/world-state-contract.md`: `R-WSTATE-002`, `R-WSTATE-005`, `R-WSTATE-006`
- `kernel/world-history-contract.md`: `R-WHIST-003`, `R-WHIST-004`, `R-WHIST-006`
- `kernel/agent-memory-contract.md`: `R-MEM-003`
- `kernel/transit-contract.md`: `R-TRANSIT-002`
- `kernel/tables/commit-authorization-matrix.yaml`: explicit run-mode matrix
- `kernel/tables/rule-evidence.yaml`: rule evidence

## 1. Scope

Realm interop mapping defines interop semantics and keeps explicit commit and append anchors, memory isolation, and continuity transfer bound to implementation anchors across the Realm surface.

## 2. Reading Path

1. `kernel/world-state-contract.md`
2. `kernel/world-history-contract.md`
3. `kernel/agent-memory-contract.md`
4. `kernel/transit-contract.md`
5. `app-interconnect-model.md`

## 3. Non-goals

No second gate model, duplicate ci execution evidence output, status dashboard, or new primitive definitions are introduced here.
