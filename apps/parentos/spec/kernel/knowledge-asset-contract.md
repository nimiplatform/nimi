# ParentOS Knowledge Asset Contract

This contract owns the admitted shape for ParentOS knowledge assets. It is
normative for asset manifests, source attribution, section semantics, schema
validation, generated projections, and runtime consumption boundaries.

The active asset registry is
`apps/parentos/spec/kernel/tables/reference-data-assets.yaml`. Active registry
`path` values must point to directory-backed asset manifests at
`apps/parentos/data/knowledge/assets/<assetId>/asset.json`. Old top-level
`apps/parentos/data/knowledge/<assetId>.json` files are not admitted authority.

## PO-KNOW-001 Asset Authority Model

An admitted knowledge asset has one registry row in
`tables/reference-data-assets.yaml` and one owner contract anchor. The registry
owns admission metadata. The owner contract owns product behavior and safety
boundaries. The asset body owns concrete reference, curated, or design content.

Target storage model:

```text
apps/parentos/data/knowledge/assets/<assetId>/asset.json
apps/parentos/data/knowledge/assets/<assetId>/schema.json
apps/parentos/data/knowledge/assets/<assetId>/<section-or-shard>.json
```

The final `asset.json` is the manifest. It must not duplicate full shard content
when a section is sharded. It must identify every source file required to
assemble the asset so orphan files and missing shards fail closed.

No generated TypeScript, Rust include, or runtime constant file is semantic
authority. Generated files are projections from admitted spec plus admitted
asset files.

## PO-KNOW-002 Manifest Field Contract

Every final `asset.json` manifest must declare:

| Field | Required | Contract |
|-------|----------|----------|
| `assetId` | yes | Stable kebab-case asset id matching the registry row and directory name. |
| `schemaVersion` | yes | Positive integer for manifest and shard schema shape. First admitted value is `1`. |
| `contentVersion` | yes | Owner-controlled content revision, independent of `schemaVersion`. |
| `authorityClass` | yes | One of `reference_dataset`, `curated_knowledge_asset`, or `design_asset`. |
| `ownerContract` | yes | Kernel contract anchor that owns product behavior and safety semantics. |
| `schema` | yes | Relative path to `schema.json` in the same asset directory. |
| `review` | yes | Review state, owner, reviewer, and last-reviewed date. |
| `sources` | required for `reference_dataset`, optional otherwise | Structured provenance entries. |
| `primarySection` | yes | Section id for the primary assembled collection/map/singleton. |
| `sections` | yes | Complete section definitions, file refs, id policy, ordering, and orphan behavior. |
| `generatedModule` | conditional | Allowed only for runtime-admitted projections. |
| `runtimeProjectionAdmission` | conditional | Required if a `design_asset` receives a runtime projection. |

If `authorityClass=design_asset`, `generatedModule` must be absent unless
`runtimeProjectionAdmission` is present and points to an admitted spec anchor.
Without that admission, the asset may inform design work only and must not be
loaded by runtime code as stable product authority.

## PO-KNOW-003 Versioning

`schemaVersion` changes only when manifest or shard schema shape changes. It is
not a content freshness marker.

`contentVersion` changes when any source, citation, ordering, section content,
semantic id set, or generated projection input changes. Wave 2 may use either a
date sequence such as `2026-05-03.1` or a content-addressed strategy admitted in
the packet. The chosen strategy must be deterministic for closeout.

Closeout must classify diffs as one of:

- `layout_only`
- `content_change`
- `schema_change`
- `ordering_change`
- `projection_bugfix`

An ordering change is semantic unless the owner contract explicitly admits it as
layout-only.

## PO-KNOW-004 Source Attribution And Review

`reference_dataset` manifests must include `sources[]`. Each source entry must
include:

| Field | Contract |
|-------|----------|
| `sourceId` | Stable id used by evaluators and generated projections. |
| `citation` | Human-readable citation or standard name. |
| `url` | Source URL when available. |
| `retrievedAt` | ISO date for source retrieval or review. |
| `licenseClass` | `public_standard`, `open_reference`, `internal_curated`, or `unknown_review_required`. |
| `sourceClass` | `clinical_reference`, `educational_reference`, `curated_parentos`, or `design_reference`. |
| `reviewStatus` | `reviewed`, `needs_review`, or `rejected`. |

Missing provenance, missing review state, or `needs_review` clinical reference
data in a runtime evaluator must fail closed. Free-text `updatePolicy` is not a
substitute for structured provenance.

## PO-KNOW-005 Section Model

Each manifest section must declare:

| Field | Contract |
|-------|----------|
| `sectionId` | Stable section id. |
| `kind` | `collection`, `map`, or `singleton`. |
| `files` | Complete relative file list or shard pattern admitted by the manifest. |
| `idField` | Required for `collection`; absent for `singleton`; optional for `map` when keys are ids. |
| `ordering` | `manifest`, `idField-asc`, `idField-desc`, or `key-asc`. |
| `orphanPolicy` | Must be `fail_close`. |
| `references` | Cross-section or cross-asset references this section emits or consumes. |

Multi-section assets must not be collapsed into a fake single collection. For
example, `observation-framework` must preserve dimensions, framework mapping,
observation modes, AI analysis rules, and journal extension semantics as
separate sections with explicit cross-reference rules.

## PO-KNOW-006 Schema Documents

Each target asset directory must include `schema.json` using JSON Schema
2020-12. The schema must validate the manifest and every referenced section or
shard file. It must reject unknown top-level manifest fields unless an owner
contract admits extension fields.

Schema files are spec-governed asset contracts, not generated output. A schema
change requires a `schemaVersion` bump and an admitted packet explaining the
consumer impact.

## PO-KNOW-007 Cross-Reference Integrity

The knowledge asset kernel must fail closed on broken references. Baseline
checks include:

- `journal-extension` dimension ids must exist in `observation-framework`
  dimensions.
- observation framework mappings must reference existing theory and dimension
  ids.
- observation modes and AI analysis rules must reference admitted dimension ids
  or section ids.
- `ability-model` design sections must not reference missing layers, signals, or
  interpretation rules.
- `growth-standards` evaluators must reference existing metric/type ids and
  declared source ids.

Cross-asset references require an owner contract anchor. Silent best-effort
joins, skipped unknown ids, and placeholder records are forbidden.

## PO-KNOW-008 Generated Projection And Fingerprint

Generated runtime modules must be deterministic projections. The generator must
compute a semantic fingerprint from:

- manifest fields that affect runtime meaning
- section file paths and ordering policy
- normalized section content
- source ids and review states
- schemaVersion and contentVersion

Closeout must fail if generated projections are stale against the semantic
fingerprint. File modification time is not sufficient freshness evidence.

## PO-KNOW-009 Runtime Consumption Boundary

Runtime and Rust/Tauri consumers must consume admitted generated projections or
the admitted asset kernel, not direct top-level JSON `include_str!` or ad hoc
JSON parsing.

Any direct read of old flat JSON paths, any unreferenced asset shard, any
dual-read fallback, or any generated-as-authority posture is a fail-close
governance violation.

`pnpm --filter @nimiplatform/parentos check:knowledge-asset-governance` is the
package-owned gate for direct-read detection, orphan shard detection, schema and
cross-reference validation, semantic projection fingerprint freshness, and
`design_asset` runtime projection prohibition.
