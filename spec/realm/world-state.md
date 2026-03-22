---
id: SPEC-REALM-WORLD-STATE-001
title: Realm World State Domain
status: active
owner: "@team"
updated: 2026-03-21
---

# Realm World State Domain

## Normative Imports

- `kernel/world-state-contract.md`: `R-WSTATE-001..006`

## Scope

World State 负责表达“世界现在变成了什么样”。它是持久共享状态层，不是 narrative runtime。

## Reading Path

1. `kernel/world-state-contract.md`
2. `kernel/tables/world-state-contract.yaml`
3. `kernel/tables/domain-state-machines.yaml`

## Non-goals

No story-local arc state, prompt context, turn pacing, or renderer control variables are defined here.
