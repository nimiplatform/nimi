# Realm Kernel Authority

## Scope

Realm kernel is the single authoritative source for cross-domain realm public boundary rules.
Every realm domain document must explicitly reference kernel Rule IDs; it must not duplicate kernel prose.

## Rule ID Format

`R-<DOMAIN>-NNN[letter]`

| Domain | Mnemonic | Kernel Document |
|---|---|---|
| `BOUND` | Boundary vocabulary | `boundary-vocabulary-contract.md` |
| `ECON` | Economy contract | `economy-contract.md` |
| `INTEROP` | Interop mapping | `interop-mapping-contract.md` |

## Numbering Convention

- Base rule IDs use three digits (`R-BOUND-001`).
- Lowercase suffixes are reserved for anchored subclauses that need independent evidence or acceptance tracking (`R-INTEROP-002a`).
- 001–00x: domain invariants
- 010–01x: first increment segment
- 020–02x: second segment
- 030+: extended segments

## Document Ownership Matrix

| Kernel Document | Rule ID Range | Description |
|---|---|---|
| `boundary-vocabulary-contract.md` | `R-BOUND-*` | World/Agent/Social public vocabulary and boundaries |
| `economy-contract.md` | `R-ECON-*` | Creator Key, pricing, revenue distribution |
| `interop-mapping-contract.md` | `R-INTEROP-*` | Six primitive → realm mapping + graduation criteria |

## Structured Fact Sources

| Table | Kernel Document | Description |
|---|---|---|
| `tables/public-vocabulary.yaml` | `boundary-vocabulary-contract.md` | Unified vocabulary (3 boundary stubs) |
| `tables/creator-key-tiers.yaml` | `economy-contract.md` | Tier pricing table |
| `tables/revenue-event-types.yaml` | `economy-contract.md` | Revenue event types |
| `tables/share-plan-fields.yaml` | `economy-contract.md` | Share plan fields and validation |
| `tables/primitive-mapping-status.yaml` | `interop-mapping-contract.md` | Six primitive mapping status |
| `tables/primitive-graduation-log.yaml` | `interop-mapping-contract.md` | Graduated primitive evidence log |
| `tables/rule-evidence.yaml` | `interop-mapping-contract.md` | Realm formal rule → executable evidence mapping |

## Downstream Reference Constraint

Domain documents under `spec/realm/` must reference at least one `R-*` Rule ID for each kernel import.
