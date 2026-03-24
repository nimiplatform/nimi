---
id: SPEC-REALM-TRANSIT-001
title: Realm Transit Domain
status: active
owner: "@team"
updated: 2026-03-21
---

# Realm Transit Domain

## Normative Imports

- `kernel/transit-contract.md`: `R-TRANSIT-001..006`

## Scope

Transit 负责跨世界连续性迁移，不负责 narrative 编排或补剧情逻辑。Creator world 之间不得直接跃迁，跨世界连续性必须经由 `OASIS` 这一默认返回点与中转锚点。

## Reading Path

1. `kernel/transit-contract.md`
2. `kernel/tables/transit-contract.yaml`
3. `kernel/tables/domain-state-machines.yaml`

## Non-goals

No time-gap fill, no synthetic story generation, and no local runtime checkpoint migration is defined here.
