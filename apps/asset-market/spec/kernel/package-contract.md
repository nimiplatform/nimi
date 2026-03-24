# Package Contract — AM-PKG-*

> Bundle / Package model, lifecycle, readiness, and reserved market concepts.

## AM-PKG-001: Split Truth and Product

Asset Market distinguishes between:

- `Bundle`
  - Realm composite truth object
- `Package`
  - market product object

The current market displays and acquires `Package`, not raw Realm `Bundle`.

## AM-PKG-002: Realm Boundary

Asset Market consumes existing Realm truth but does not redefine it.

- `Asset` remains the formal platform asset object
- `Bundle` remains the formal Realm composite object
- `Package` is a market business object layered above one `Bundle`
- `Package` carries its own product ownership field, but that ownership must stay aligned with the referenced `Bundle`
- Package lifecycle must not overwrite the meaning of Realm asset or bundle truth

## AM-PKG-003: Bundle and Package Field Model

`Bundle` and `Package` required fields and readiness requirements are authoritative in `tables/package-model.yaml`.

This includes:

- Bundle identity and ordered asset membership
- Bundle lifecycle and import-facing metadata
- Package product fields and publishability signals
- Package lifecycle and market-facing readiness

## AM-PKG-004: Ordered Bundle Membership

Bundle asset membership is ordered, not set-like.

- order has truth meaning
- order may also have downstream creative meaning
- publish and import flows must preserve bundle order

## AM-PKG-005: Bundle Cover Rule

`Bundle.coverAssetId`, when present, must reference an asset already contained in the bundle.

Default cover selection may derive from the first ordered asset, but creators may change it before publish.

## AM-PKG-006: Readiness

`Bundle` and `Package` readiness are automatic.

- `isReady` is a derived signal
- `readinessIssues[]` enumerates missing requirements
- users do not manually toggle readiness

## AM-PKG-007: Lifecycle Split

`Bundle.status` and `Package.status` are independent.

Both are currently limited to:

- `draft`
- `published`
- `archived`

`publishedAt` becomes required once either object has entered `published` or `archived` state.

A published `Package` must reference a published `Bundle`.

## AM-PKG-008: Update and Republish

Published packages may continue to be edited, but market-visible changes do not take effect until a new explicit publish action occurs.

Each republish increments the Package `version`.

## AM-PKG-009: Empty Draft Cleanup

An empty draft package may temporarily remain while the creator is still inside the current editing context.

Once the creator leaves that context, an empty draft package should be removed automatically.

## AM-PKG-010: Reserved Future Projection

`PackageListing` is reserved as a future market-facing projection if the system later needs listing semantics that diverge from `Package` lifecycle semantics.

It is not part of the current active object model.
