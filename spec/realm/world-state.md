# Realm World State Public Boundary

> Domain: Realm / World State

## 0. Normative Imports

- `kernel/boundary-vocabulary-contract.md`: `R-BOUND-001`, `R-BOUND-010`
- `kernel/interop-mapping-contract.md`: `R-INTEROP-001`, `R-INTEROP-002`

## 1. Scope

World State 负责表达“世界现在变成了什么样”。它是持久共享状态层，不是 narrative runtime。

## 2. Reading Path

1. `kernel/boundary-vocabulary-contract.md`
2. `kernel/interop-mapping-contract.md`
3. `world.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No story-local arc state, prompt context, turn pacing, or renderer control variables are defined here.
