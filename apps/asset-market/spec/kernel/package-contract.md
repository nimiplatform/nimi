# Package Contract — AM-PKG-*

> AssetPackage model, lifecycle, readiness, and reserved market concepts.

## AM-PKG-001: Package Consumption Unit

`AssetPackage` is the current market consumption unit.

- It is composed from one or more existing Realm assets
- It is the object displayed by the current market
- It is the object imported into Forge by current market flows

Current market display does not require a separate active `AssetPackageListing` object.

## AM-PKG-002: Realm Boundary

Asset Market consumes existing Realm assets but does not redefine Realm asset truth.

- `Asset` remains the formal platform object
- `AssetPackage` is a package-market business object layered above existing assets
- Package lifecycle must not overwrite the meaning of Realm asset ownership, visibility, or release truth

## AM-PKG-003: Package Field Model

`AssetPackage` required fields and readiness requirements are authoritative in `tables/package-model.yaml`.

This includes:

- identity
- ownership
- package typing
- ordered asset membership
- publishability signals
- lifecycle metadata

## AM-PKG-004: Ordered Asset Membership

Package asset membership is ordered, not set-like.

- order has display meaning
- order may also have downstream creative meaning
- publish and import flows must preserve package order

## AM-PKG-005: Cover Rule

`coverAssetId` must reference an asset already contained in the package.

Default cover selection may derive from the first ordered asset, but creators may change it before publish.

## AM-PKG-006: Readiness

`AssetPackage` readiness is automatic.

- `isReady` is a derived signal
- `readinessIssues[]` enumerates missing publish requirements
- users do not manually toggle readiness

## AM-PKG-007: Lifecycle

`AssetPackage.status` is limited to:

- `draft`
- `published`
- `archived`

`published` means the package is currently market-visible in the current model.

`publishedAt` becomes required once a package has entered `published` or `archived` state.

## AM-PKG-008: Update and Republish

Published packages may continue to be edited, but market-visible changes do not take effect until a new explicit publish action occurs.

Each republish increments `version`.

## AM-PKG-009: Empty Draft Cleanup

An empty draft package may temporarily remain while the creator is still inside the current editing context.

Once the creator leaves that context, an empty draft package should be removed automatically.

## AM-PKG-010: Reserved Future Projection

`AssetPackageListing` is reserved as a future market-facing projection if the system later needs listing semantics that diverge from `AssetPackage` lifecycle semantics.

It is not part of the current active object model.
