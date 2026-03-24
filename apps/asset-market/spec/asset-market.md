# Asset Market — Top-Level Product Spec

> Status: Active | Date: 2026-03-24

## Product Positioning

Asset Market is a standalone creator-facing market application in the nimi ecosystem.

Its primary product is a reusable package market for creators:

- **Discover** — Find reusable creator packages through search, categories, and lightweight popularity/newness views
- **Import** — Send selected packages into Forge as upstream creative input
- **Publish** — Compose and publish market-facing `AssetPackage` objects from existing Realm assets
- **Library** — Manage the creator's available and saved packages

Asset Market is not a generic consumer storefront and is not a replacement for Forge or Scene-Atlas.

## Core Boundary

Asset Market does **not** redefine Realm `Asset`.

- Realm `Asset` remains the formal platform asset object
- Asset Market consumes existing Realm assets
- Asset Market introduces `AssetPackage` as a market consumption unit built from one or more existing Realm assets
- Current market display is based directly on published `AssetPackage`
- `AssetPackageListing` is reserved for future expansion only and is not part of the current active model

## Primary User

The primary user is a **creator / content producer** who wants to:

- discover reusable scene, character, or style packages
- import those packages into Forge for world and content creation
- publish their own packages assembled from assets they already own inside Realm

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.10 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand |
| Data fetching | TanStack Query |
| SDK | `@nimiplatform/sdk/runtime` + `@nimiplatform/sdk/realm` |
| Kit core | `@nimiplatform/nimi-kit/core/*` |

Asset Market follows the same SDK-first shell pattern used by Forge:

- **Platform client** — `createPlatformClient({ appId: 'nimi.asset-market', runtimeTransport: 'tauri-ipc', sessionStore })`
- **Runtime / Realm** — consumed from the returned SDK client instead of app-local constructors

## Relationship to Other Products

| Product | Role relative to Asset Market |
|---------|-------------------------------|
| `Scene-Atlas` | Upstream scene working-state tool that may eventually publish assets into Realm |
| `Forge` | Primary downstream consumer of packages imported from Asset Market |
| Realm `Asset` | Existing formal asset object consumed by Asset Market |
| `Desktop` | Broader host/shell product; not the package market itself |

## Product Navigation

Primary navigation:

- `Discover`
- `Library`
- `Publish`
- `Account`

`Discover` is the default home and primary product surface.

## Package Categories

Current market categories are creator-purpose categories:

- `Scenes`
- `Characters`
- `Styles`

Media type stays a secondary filter, not a primary category axis.

## Object Model Summary

### Current Active Objects

- `Asset`
  - Existing Realm formal asset object
- `AssetPackage`
  - Market consumption unit composed from one or more Realm assets

### Upstream Mappings

- `SceneCard` is an upstream working-state object and may be published into a Realm `Asset`
- `ScenePack` is an upstream working-state object and may be published into an `AssetPackage`

These are conceptual publish mappings only. This spec does not freeze field-level conversion details.

### Reserved Future Object

- `AssetPackageListing`
  - Reserved as a future market-facing projection if market display semantics later diverge from `AssetPackage` lifecycle semantics

## Project Location

```text
nimi/apps/asset-market/
├── spec/                        # This spec tree
└── (implementation to be added)
```

## Normative Imports

This spec imports the following kernel contracts:

| Contract | Rule prefix | Scope |
|----------|-------------|-------|
| `kernel/app-shell-contract.md` | AM-SHELL-* | shell, bootstrap, navigation |
| `kernel/package-contract.md` | AM-PKG-* | package model, lifecycle, readiness |
| `kernel/discovery-contract.md` | AM-DISCOVER-* | discover, search, detail |
| `kernel/publish-contract.md` | AM-PUBLISH-* | package composition and publish |
| `kernel/library-contract.md` | AM-LIB-* | available and saved views |
| `kernel/account-contract.md` | AM-ACCOUNT-* | account records and profile |

## Non-Goals

- Asset Market does not redefine Realm asset truth
- Asset Market does not consume `ScenePack` directly; it consumes admitted Realm assets
- Asset Market is not a Photoshop-like editor, generator, or world authoring surface
- Asset Market does not currently introduce a separate active `AssetPackageListing` lifecycle
