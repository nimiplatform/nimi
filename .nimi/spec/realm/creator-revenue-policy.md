---
id: SPEC-REALM-CREATOR-REVENUE-POLICY-001
title: Realm Creator Revenue Policy Bridge
status: active
owner: "@team"
updated: 2026-03-26
---

# Creator Revenue Policy

## Normative Imports

- `kernel/economy-contract.md` (`R-ECON-001..004`)

## Scope

Bridge-only policy alignment. This file preserves the legacy open revenue anchors while mapping them onto the current kernel execution anchors and tables.

## Mapping Declaration

| External Anchor | Local Kernel Anchor |
| --- | --- |
| `R-ECON-010` | `R-ECON-003` |
| `R-ECON-020` | `R-ECON-003`, `R-ECON-004` |
| `R-ECON-021` | `R-ECON-004` |
| `R-ECON-022` | `R-ECON-003`, `R-ECON-004` |
| `R-ECON-023` | `R-ECON-001`, `R-ECON-003` |
| `R-ECON-024` | `R-ECON-003` |
| `R-ECON-025` | `R-ECON-003`, `R-ECON-004` |
| `R-ECON-040` | `R-ECON-001`, `R-ECON-004` |

## Reading Path

1. `kernel/economy-contract.md`
2. `kernel/tables/rule-catalog.yaml`
3. `economy.md`

## Non-goals

- No independent share-plan model in open spec.
- No override of backend ledger semantics.
- No duplication of open-spec execution formulas.
