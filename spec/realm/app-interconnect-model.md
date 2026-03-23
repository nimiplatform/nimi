---
id: SPEC-REALM-APP-INTERCONNECT-001
title: Realm App Interconnect Model Bridge
status: active
owner: "@team"
updated: 2026-03-21
---

# Realm App Interconnect Model

## Normative Imports

- `kernel/truth-contract.md` (`R-TRUTH-001..006`)
- `kernel/world-state-contract.md` (`R-WSTATE-001..006`)
- `kernel/world-history-contract.md` (`R-WHIST-001..006`)
- `kernel/agent-memory-contract.md` (`R-MEM-001..006`)
- `kernel/chat-contract.md` (`R-CHAT-001..004`)
- `kernel/social-contract.md` (`R-SOC-001..004`)
- `kernel/economy-contract.md` (`R-ECON-001..004`)
- `kernel/asset-contract.md` (`R-ASSET-001..004`)
- `kernel/transit-contract.md` (`R-TRANSIT-001..004`)
- `spec/platform/ai-last-mile.md`

## Scope

Bridge-only document. It mirrors the hard-cut realm interconnect semantics exposed by the local canonical contract set without introducing a second rule system in open spec.

## Mapping Declaration

| Mirror Anchor | Open Anchor |
| --- | --- |
| `R-TRUTH-001..006` | `R-TRUTH-001..006` |
| `R-WSTATE-001..006` | `R-WSTATE-001..006` |
| `R-WHIST-001..006` | `R-WHIST-001..006` |
| `R-MEM-001..006` | `R-MEM-001..006` |
| `R-CHAT-001..004` | `R-CHAT-001..004` |
| `R-SOC-001..004` | `R-SOC-001..004` |
| `R-ECON-001..004` | `R-ECON-001..004` |
| `R-ASSET-001..004` | `R-ASSET-001..004` |
| `R-TRANSIT-001..004` | `R-TRANSIT-001..004` |

## Reading Path

1. `kernel/index.md`
2. `kernel/truth-contract.md`
3. `kernel/world-state-contract.md`
4. `kernel/world-history-contract.md`
5. `kernel/agent-memory-contract.md`
6. `kernel/chat-contract.md`
7. `kernel/social-contract.md`
8. `kernel/economy-contract.md`
9. `kernel/asset-contract.md`
10. `kernel/transit-contract.md`
11. `spec/platform/ai-last-mile.md`

## Non-goals

- No new open-spec rule ID prefix.
- No duplicate rule prose of kernel contracts.
- No runtime execution evidence output in this document.
