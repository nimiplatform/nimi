---
id: SPEC-REALM-ASSET-001
title: Realm Asset Domain
status: active
owner: '@team'
updated: 2026-03-25
---

# Realm Asset Domain

## Normative Imports

- `kernel/resource-contract.md`: `R-RSRC-001..006`
- `kernel/attachment-contract.md`: `R-ATTACH-001..004`
- `kernel/binding-contract.md`: `R-BIND-001..005`
- `kernel/asset-contract.md`: `R-ASSET-101..105`
- `kernel/bundle-contract.md`: `R-BNDL-001..004`

## Scope

Asset 域在本轮 hard cut 中拆为五层：`Resource`（内容载体）、`Attachment`（跨 Post / Chat 的附着包络）、`Binding`（正式 durable relation）、`OwnableAsset`（独立可拥有正式对象）、`Bundle`（组合与导入单位）。该域不承担叙事运行态，也不承担商品化语义。

`OwnableAsset.resourceRefs` 只表示 asset 的资源成员集合，不再承载 preview 真相。preview 真相由显式 `previewResourceId` 管理；`Bundle` 的 card preview 仅允许沿 `coverAssetId -> previewResourceId` 链解析，缺失时返回 `CARD` 且 `preview` 为空。

## Reading Path

1. `kernel/resource-contract.md`
2. `kernel/attachment-contract.md`
3. `kernel/binding-contract.md`
4. `kernel/asset-contract.md`
5. `kernel/bundle-contract.md`
6. `kernel/tables/resource-contract.yaml`
7. `kernel/tables/attachment-contract.yaml`
8. `kernel/tables/binding-contract.yaml`
9. `kernel/tables/asset-contract.yaml`
10. `kernel/tables/bundle-contract.yaml`
11. `creator-revenue-policy.md`

## Non-goals

No app-private archive, no renderer output cache, and no narrative spine artifact storage is defined here. Raw `Resource` objects are not automatically `OwnableAsset` objects.
