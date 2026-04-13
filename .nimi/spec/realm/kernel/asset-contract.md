---
id: SPEC-REALM-KERNEL-ASSET-001
title: Realm Ownable Asset Kernel Contract
status: active
owner: "@team"
updated: 2026-03-26
---

# Ownable Asset Contract

> Domain: asset
> Rule family: R

## Scope

This contract defines `OwnableAsset` as the Realm-level formal object family for independently ownable digital assets in `nimi-realm`. The asset rule family intentionally retains the `101..105` numbering series to stay aligned with the external open-spec asset anchors; `001..100` remain reserved and are not active local rules.

## R-ASSET-101

Realm `OwnableAsset` objects are independently ownable formal objects with stable identity, owner, authorship, lineage, lifecycle, and binding policy semantics. Active `kind` values are `WORK` and `ITEM`. Active `originKind` values are `ORIGINAL`, `CLONE`, and `DERIVED`. Active policy values are `ALLOW`, `DENY`, and `INHERIT`.

## R-ASSET-102

`OwnableAsset` is distinct from `Resource`, world truth, world history, and agent memory. Raw content carriers and app-private archives must not masquerade as ownable realm assets.

## R-ASSET-103

`OwnableAsset` mutations must be explicit, idempotent, and auditable. Create, update, clone, and lifecycle transitions are first-class state changes, not silent side effects of resource upload. The active asset lifecycle status set is `DRAFT`, `READY`, `ARCHIVED`, and `DELETED`.

## R-ASSET-104

Formal asset use must remain boundary-safe. Runtime or creator surfaces may bundle `OwnableAsset` objects or express formal asset use only through `Binding(kind=USE, objectType=ASSET)`, while ownership, lifecycle, policy, and lineage truth remain inside Realm.

## R-ASSET-105

Asset preview truth is explicit and separate from asset composition. `OwnableAsset.resourceRefs` defines the asset member resource set only and must reference real, undeleted, attachable `Resource` objects that the current actor is allowed to reference; `OwnableAsset.previewResourceId`, when present, must reference one member of `resourceRefs`, and read surfaces must not infer preview truth from `resourceRefs` ordering. Asset and bundle preview exposure through attachment read models still does not change ownership, authorship, acquisition, lifecycle, or policy truth.
