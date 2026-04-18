---
id: SPEC-REALM-INTEROP-MAPPING-001
title: Realm Interop Mapping Bridge
status: active
owner: "@team"
updated: 2026-04-18
---

# Realm Interop Mapping

## Normative Imports

- `kernel/world-state-contract.md` (`R-WSTATE-002`, `R-WSTATE-005`, `R-WSTATE-006`)
- `kernel/world-history-contract.md` (`R-WHIST-003`, `R-WHIST-004`, `R-WHIST-006`)
- `kernel/transit-contract.md` (`R-TRANSIT-002`)

## Scope

Bridge-only document for interop semantics. It binds explicit commit and append anchors to the mirrored kernel implementation anchors and keeps rule authority in kernel contracts and tables.

## Mapping Declaration

| External Anchor | Local Kernel Anchor |
| --- | --- |
| `R-WSTATE-002` | `R-WSTATE-002` |
| `R-WSTATE-005` | `R-WSTATE-005` |
| `R-WSTATE-006` | `R-WSTATE-006` |
| `R-WHIST-003` | `R-WHIST-003` |
| `R-WHIST-004` | `R-WHIST-004` |
| `R-WHIST-006` | `R-WHIST-006` |
| `R-TRANSIT-002` | `R-TRANSIT-002` |

## Reading Path

1. `kernel/index.md`
2. `kernel/world-state-contract.md`
3. `kernel/world-history-contract.md`
4. `kernel/transit-contract.md`

## Non-goals

- No new primitive definitions in open spec.
- No status dashboard for PARTIAL/COVERED in this file.
- No CI execution evidence output in this file.
