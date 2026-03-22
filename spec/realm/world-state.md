# Realm World State Public Boundary

> Domain: Realm / World State

## 0. Normative Imports

- `kernel/world-state-contract.md`: `R-WSTATE-001`, `R-WSTATE-002`, `R-WSTATE-003`, `R-WSTATE-004`, `R-WSTATE-005`, `R-WSTATE-006`

## 1. Scope

World State 负责表达“世界现在变成了什么样”。它是持久共享状态层，不是 narrative runtime。

## 2. Reading Path

1. `kernel/world-state-contract.md`
2. `kernel/tables/world-state-contract.yaml`
3. `world.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No story-local arc state, prompt context, turn pacing, or renderer control variables are defined here.
