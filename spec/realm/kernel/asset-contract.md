# Asset Contract

> Owner Domain: `R-ASSET-*`

## R-ASSET-001 — Creator Asset Public Model

Realm provides a creator-owned asset model for personal publishable works.

`MUST`:

- expose stable `assetId` + `assetType`
- preserve creator ownership and visibility semantics
- support release history for evolving assets
- treat archive as a lifecycle state, not a silent hard delete guarantee

Asset public vocabulary is declared in `tables/public-vocabulary.yaml` under the `asset` domain.

## R-ASSET-010 — NovelAsset Is A Book-Level Creator Asset Type

Realm `NovelAsset` is the canonical asset type for serialized novels.

Its type-level constraints are defined in `tables/realm-asset-types.yaml`.

`MUST`:

- use book as the primary asset granularity
- keep volumes and chapters as internal structure, not primary assets
- support evolving serialized publication on one long-lived asset

## R-ASSET-011 — NovelAsset Metadata Minimum

NovelAsset metadata fields are defined in `tables/realm-asset-types.yaml`.

`MUST` include at least:

- identity fields sufficient to resolve the work and owner
- discovery fields sufficient to list and classify the work
- serialization fields sufficient to track publish progress
- media reference fields sufficient to bind cover assets

## R-ASSET-012 — NovelAsset Structure And Release Records

NovelAsset structural fields and release record fields are defined in `tables/realm-asset-types.yaml`.

`MUST` support:

- ordered volumes
- ordered chapters
- chapter-to-volume placement
- `publishedChapterCursor`
- append-only `NovelReleaseEvent` records for each successful publish

## R-ASSET-020 — Serialized Publish Mutations Are Idempotent

Realm publish mutations against serialized assets must be idempotent at the asset-update boundary.

`MUST`:

- avoid duplicate chapter exposure on retry
- preserve append-only release history
- avoid silently rewinding already published chapters during routine update flows
