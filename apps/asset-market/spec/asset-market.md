# Asset Market — Top-Level Product Spec

> Status: Active | Date: 2026-03-24

## Product Positioning

Asset Market is a standalone creator-facing market application in the nimi ecosystem.

Its primary product is a reusable package market for creators:

- **Discover** — Find reusable creator packages through search, categories, and lightweight popularity/newness views
- **Import** — Send selected packages into Forge as upstream creative input
- **Publish** — Compose market-facing `Package` objects from existing Realm `Bundle` truth
- **Library** — Manage the creator's available and saved packages

Asset Market is not a generic consumer storefront and is not a replacement for Forge or Scene-Atlas.

## Core Boundary

Asset Market does **not** redefine Realm `Asset` or `Bundle`.

- Realm `Asset` remains the formal platform asset object
- Realm `Bundle` remains the formal composite truth object
- Asset Market consumes existing Realm `Asset` and `Bundle` truth
- Asset Market introduces `Package` as a market product object layered above one Realm `Bundle`
- Current market display is based directly on published `Package`
- `PackageListing` is reserved for future expansion only and is not part of the current active model

## Primary User

The primary user is a **creator / content producer** who wants to:

- discover reusable scene, character, or style packages
- import those packages into Forge for world and content creation
- publish their own packages from Realm-backed bundle truth

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
| `Scene-Atlas` | Upstream scene working-state tool that may eventually publish assets and bundles into Realm |
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
- `Bundle`
  - Realm composite truth object composed from one or more assets
- `Package`
  - Market product object that points to one Bundle and carries aligned product ownership

### Upstream Mappings

- `SceneCard` is an upstream working-state object and may be published into a Realm `Asset`
- `ScenePack` is an upstream working-state object and may be published into a Realm `Bundle`

These are conceptual publish mappings only. This spec does not freeze field-level conversion details.

### Reserved Future Object

- `PackageListing`
  - Reserved as a future market-facing projection if market display semantics later diverge from `Package` lifecycle semantics

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

- Asset Market does not redefine Realm truth
- Asset Market does not consume `ScenePack` directly; it consumes admitted Realm `Asset` and `Bundle` truth
- Asset Market is not a Photoshop-like editor, generator, or world authoring surface
- Asset Market does not currently introduce a separate active `PackageListing` lifecycle
