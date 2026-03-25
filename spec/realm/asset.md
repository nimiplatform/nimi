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
- `kernel/asset-contract.md`: `R-ASSET-101..105`
- `kernel/bundle-contract.md`: `R-BNDL-001..004`

## Scope

Asset 域在本轮 hard cut 中拆为四层：`Resource`（内容载体）、`Attachment`（跨 Post / Chat 的附着包络）、`OwnableAsset`（独立可拥有正式对象）、`Bundle`（组合分发与导入单位）。该域不承担叙事运行态。

`OwnableAsset.resourceRefs` 只表示 asset 的资源成员集合，不再承载 preview 真相。preview 真相由显式 `previewResourceId` 管理；`Bundle` 的 card preview 仅允许沿 `coverAssetId -> previewResourceId` 链解析，缺失时返回 `CARD` 且 `preview` 为空。

## Reading Path

1. `kernel/resource-contract.md`
2. `kernel/attachment-contract.md`
3. `kernel/asset-contract.md`
4. `kernel/bundle-contract.md`
5. `kernel/tables/resource-contract.yaml`
6. `kernel/tables/attachment-contract.yaml`
7. `kernel/tables/asset-contract.yaml`
8. `kernel/tables/bundle-contract.yaml`
9. `creator-revenue-policy.md`

## Non-goals

No app-private archive, no renderer output cache, and no narrative spine artifact storage is defined here. Raw `Resource` objects are not automatically `OwnableAsset` objects.
