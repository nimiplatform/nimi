---
id: SPEC-REALM-BINDING-001
title: Realm Binding Domain
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Binding Domain

## Normative Imports

- `kernel/binding-contract.md`: `R-BIND-001..005`
- `kernel/tables/domain-enums.yaml`: `BINDING-OBJECT-TYPE`, `BINDING-HOST-TYPE`, `BINDING-KIND`, `BINDING-POINT`

## Scope

Binding 是 `nimi-realm` 中唯一正式的 durable object-to-host relation 薄文档入口。它只负责 formal relation truth，不复述 `Attachment`、`Resource`、`OwnableAsset` 或 `Bundle` 的对象语义。

## Reading Path

1. `kernel/binding-contract.md`
2. `kernel/tables/binding-contract.yaml`
3. `kernel/tables/domain-enums.yaml`
4. `asset.md`
5. `world.md`

## Non-goals

No display-envelope semantics, no implicit attachment upgrade, and no editor-local draft binding state is defined here.
