---
id: SPEC-REALM-KERNEL-ASSET-001
title: Realm Asset Kernel Contract
status: active
owner: "@team"
updated: 2026-03-21
---

# Asset Contract

> Domain: asset
> Rule family: R

## Scope

This contract defines creator-owned publishable assets in `nimi-realm`.

## R-ASSET-001

Realm assets are creator-owned publishable works with stable identity, visibility, lifecycle, and release history semantics.

## R-ASSET-002

Asset storage is distinct from world truth, world history, and agent memory. App-private archives and renderer artifacts must not masquerade as core realm assets.

## R-ASSET-003

Asset mutations must be explicit, idempotent, and auditable. Publish and archive are lifecycle transitions, not silent side effects.

## R-ASSET-004

Asset consumption by apps must remain boundary-safe. An app may reference an asset, but asset ownership and release truth remain inside Realm.
