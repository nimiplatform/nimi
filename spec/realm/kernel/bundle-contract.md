---
id: SPEC-REALM-KERNEL-BUNDLE-001
title: Realm Bundle Kernel Contract
status: active
owner: '@team'
updated: 2026-03-25
---

# Bundle Contract

> Domain: bundle
> Rule family: R

## Scope

This contract defines `Bundle` as the Realm-level composition, distribution, market, and import unit for ordered groups of `OwnableAsset` objects.

## R-BNDL-001

Realm `Bundle` objects are formal composition units with stable identity, owner, member ordering, cover asset, metadata, lifecycle, and market/import semantics.

## R-BNDL-002

`Bundle` members must be `OwnableAsset` references only. Raw `Resource` objects must not appear as direct bundle members.

## R-BNDL-003

Bundle mutations must be explicit, idempotent, and auditable. Draft editing, publish, archive, acquire, and import are first-class lifecycle or event transitions.

## R-BNDL-004

Bundle attachment preview resolution is fixed to `Bundle.coverAssetId -> OwnableAsset.previewResourceId -> nested Attachment.preview`. If the cover asset has no explicit preview resource, bundle read models remain `CARD` without an inferred preview. Bundle acquisition or import still does not imply runtime binding of member assets; runtime use remains explicit and boundary-safe through asset binding or app-specific import flows.
