# Realm App Interconnect Model

> Domain: Realm / App Interconnect Model

## 0. Normative Imports

- `kernel/boundary-vocabulary-contract.md`: `R-BOUND-001`, `R-BOUND-002`, `R-BOUND-003`, `R-BOUND-004`, `R-BOUND-005`, `R-BOUND-010`
- `kernel/asset-contract.md`: `R-ASSET-001`, `R-ASSET-010`, `R-ASSET-020`
- `kernel/interop-mapping-contract.md`: `R-INTEROP-001`, `R-INTEROP-002`
- `kernel/economy-contract.md`: `R-ECON-010`, `R-ECON-020`, `R-ECON-030`, `R-ECON-040`
- `spec/platform/ai-last-mile.md`

## 1. Scope

App interconnect defines Realm as a cross-application semantic layer built around `Truth / World State / World History / Agent Memory`, with `Chat` retained only as `HUMAN_HUMAN + DIRECT`.

## 2. Reading Path

1. `kernel/boundary-vocabulary-contract.md`
2. `kernel/asset-contract.md`
3. `kernel/interop-mapping-contract.md`
4. `spec/platform/ai-last-mile.md`
5. `world.md`
6. `agent.md`
7. `chat.md`

## 3. Non-goals

No runtime orchestration, prompt state, provider routing knobs, or story archive masquerading as canonical history is defined here.
