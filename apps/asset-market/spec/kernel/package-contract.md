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

## AM-PKG-011: Package Kind Discriminator

`Package.package_kind` is the structural discriminator for package-specific readiness, compatibility, acquisition, and downstream consumer routing.

The authoritative kind set is `package_model.package_kinds` in `tables/package-model.yaml`.

Current active package kinds are listed in the table. Future package kinds must be admitted in the table before any publish, acquisition, import, or consumer surface treats them as active.

## AM-PKG-012: Category and Package Kind Split

`Package.category` and `Package.package_kind` are separate axes.

- `category` is the market-facing discovery classification axis.
- `package_kind` is the structural/product discriminator.
- `category` must not be used to infer package-specific readiness, backend compatibility, or consumer routing.
- `package_kind` must not replace category filtering unless a later Asset Market redesign explicitly changes `AM-DISCOVER-*`, `AM-PUBLISH-*`, and `AM-LIB-*` together.

## AM-PKG-013: Package Kind Admission

Adding an active `Package.package_kind` value requires a single Asset Market admission path:

- append the value in `tables/package-model.yaml`
- define required fields and readiness issues for that kind
- define any publish, acquisition, import, and API surface impact
- prove no app-local package model or loose file activation path bypasses `Package`

Reserved future kind names are not active values and must fail publish/acquisition/import until promoted by an admitted Asset Market topic.

## AM-PKG-014: Active Avatar Package Kind

`Package.package_kind = avatar` is an active Asset Market package kind for launched Avatar visual packages.

Avatar packages are Asset Market products backed by Realm `Bundle` membership. They are not loose folders, direct CDN rows, Desktop bindings, or Agent Center inventory records.

An avatar package must carry the package-kind-specific fields defined in `tables/package-model.yaml`, including `backend_kind`, `backend_capability_profile_ref`, `avatar_model_layout`, `provenance`, and `compatibility_diagnostics`.

## AM-PKG-015: Avatar Backend Kind Boundary

Active avatar packages may target only admitted launched Avatar backends:

- `live2d`
- `vrm`

`sprite2d`, `canvas2d`, `video`, and any future renderer format are not active avatar package backends. Preview-only formats must use a separately admitted preview package kind and must not activate as launched Avatar carriers.

## AM-PKG-016: Avatar Model Layout

`avatar_model_layout` maps the package's Realm `Bundle` members into a backend loader layout.

It must identify the entry asset, runtime root, required asset ids, and backend-specific entry path fields. Every referenced asset id must belong to the referenced `Bundle`; absolute paths, URLs, and host-local paths are not layout truth.

The layout is package metadata. Avatar may materialize it locally after authorization, but that local materialization is not package truth.

## AM-PKG-017: Avatar Package Provenance and Compatibility

Avatar packages require provenance and backend compatibility evidence before readiness.

- `provenance` records the admitted source and stable fingerprint.
- `backend_capability_profile_ref` points to Avatar backend capability evidence.
- `compatibility_diagnostics` records blocking and non-blocking validation findings.

Blocking diagnostics fail readiness and publish. Non-blocking diagnostics may be surfaced in discovery/detail/import UI, but they must not be treated as success evidence.
