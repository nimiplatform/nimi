---
id: SPEC-REALM-WORLD-CREATOR-ECONOMY-001
title: Realm World Creator Economy Bridge
status: active
owner: "@team"
updated: 2026-03-16
---

# World Creator Economy

## Normative Imports

- `kernel/economy-contract.md` (`R-ECON-001..004`)

## Scope

Bridge-only document for creator economy semantics. Kernel authority remains in `spec/realm/kernel/economy-contract.md`; this file preserves the legacy open bridge anchors while mirroring the local hard-cut semantics.

## Mapping Declaration

| External Anchor | Local Kernel Anchor |
| --- | --- |
| `R-ECON-001` | `R-ECON-001` |
| `R-ECON-030` | `R-ECON-001`, `R-ECON-003` |

## Reading Path

1. `kernel/economy-contract.md`
2. `kernel/tables/rule-catalog.yaml`
3. `truth.md`

## Non-goals

- No standalone pricing table definition in open spec.
- No new revenue policy rule IDs in realm.
- No duplication of open-spec frozen narrative sections.
