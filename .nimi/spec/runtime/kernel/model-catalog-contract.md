# Runtime Model Catalog Contract

> Owner Domain: `K-MCAT-*`

Split authority map:

- `model-catalog-voice-workflow-contract.md`: K-MCAT-007, K-MCAT-010, K-MCAT-012..019, K-MCAT-023..024, K-MCAT-026, and K-MCAT-028..031
- `model-catalog-provider-metadata-contract.md`: K-MCAT-011, K-MCAT-020..022, K-MCAT-025, and K-MCAT-027
- `model-catalog-local-resolver-contract.md`: K-MCAT-032..037
## K-MCAT-000 Runtime Target Identity v2 Hard Cut

`K-RTARGET-*` defines durable target identity. Provider/catalog `model_id`
fields in this document are catalog/provider facts only. Runtime cloud target
identity is `remote_model_catalog_id`; provider model ids cannot mint durable
target refs without Runtime-owned catalog snapshot resolution.

## K-MCAT-001 SSOT Location

Runtime model/voice schema and behavior rules are defined in this contract (`K-MCAT-*`).
Runtime default data MUST be loaded from `runtime/catalog/providers/*.yaml` (provider-scoped files), not from `.nimi/spec/runtime/kernel/tables/*`.
Source-provider entries under `runtime/catalog/source/providers/` are the authoring SSOT for source-provider metadata, including endpoint/runtime facts that are later projected into snapshot / registry / spec tables. A provider entry MAY be either `<provider>.source.yaml` or a `<provider>/` directory of YAML fragments merged by source tooling.
`tables/provider-catalog.yaml` is the projected remote-endpoint table for remote providers and therefore intentionally excludes `local`.

## K-MCAT-002 Field Schema

Each provider file in `runtime/catalog/providers/*.yaml` MUST include:

- `version`
- `provider`
- `catalog_version`
- `inventory_mode`
- `default_text_model` (optional; remote text-capable providers only)
- `selection_profiles` (optional; reviewed provider-level recommendations)
- `models` (optional only when `inventory_mode=dynamic_endpoint`)
- `voices` (optional; required only when TTS-capable models exist)

`inventory_mode` MUST be one of:

- `static_source`
- `dynamic_endpoint`

When `inventory_mode=dynamic_endpoint`, provider snapshot MAY omit static
`models` rows and instead MUST include provider-level dynamic inventory metadata.

`models[]` entries MUST include:

- `provider`
- `model_id`
- `model_type`
- `updated_at`
- `capabilities`
- `pricing`
- `source_ref`

`models[]` capability-conditional fields:

- when capability includes `audio.synthesize`: `voice_set_id` MUST be present.
- when capability includes `audio.synthesize` and speech route-describe metadata is admitted: `voice_request_options` MAY be present.
- when capability includes `audio.transcribe` and speech route-describe metadata is admitted: `transcription` MAY be present.
- when capability includes `image.generate` and image route-describe metadata is admitted: `image_request_options` MUST be present.
- when capability includes `video.generate`: `video_generation` MUST be present.
- when capability includes `text.embed` and the model has a single admitted output dimension: `embedding` MAY be present. `embedding.dimension` MUST be a positive integer and is the catalog authority for the runtime memory embedding profile dimension (`K-MEM-004`, `K-AIEXEC-006`). The `embedding` field MUST NOT appear on a model that does not declare `text.embed`. A `text.embed` model with variable or preview-only output dimension MAY omit `embedding`; runtime then fails closed when asked to resolve an embedding profile for that model rather than fabricating a dimension.

`voices[]` entries MUST include:

- `voice_set_id`
- `provider`
- `voice_id`
- `name`
- `langs`
- `model_ids`
- `source_ref`

## K-MCAT-003 Pricing Normalization

`pricing` MUST use normalized metering units: `token|char|second|request`. Each entry MUST include `input`, `output`, `currency`, `as_of`, and `notes`. Unknown pricing values are allowed only as literal `"unknown"`.

Value semantics for `input` and `output` fields:

- `unit: token` — price in `currency` **per 1,000,000 tokens**
- `unit: char` — price in `currency` **per 1,000,000 characters**
- `unit: second` — price in `currency` **per 60 seconds** of compute/audio
- `unit: request` — price in `currency` **per single request**

When `currency: "none"` (local models), `input` and `output` MUST be set to `"0"` (not `"unknown"`) to indicate zero provider-side cost.

## K-MCAT-004 Source Traceability

Every model and voice entry MUST include `source_ref` with authoritative provider documentation URL and `retrieved_at` date.

## K-MCAT-005 Runtime Resolution Order

Runtime catalog resolution order MUST be:

1. Built-in snapshot (required)
2. Local custom provider directory (`modelCatalogCustomDir`) (optional)

Remote metadata cache / refresh MUST NOT exist as a non-scenario catalog source.
Dynamic connector model discovery cache MAY exist as runtime execution cache only
for `inventory_mode=dynamic_endpoint`; it MUST NOT become a second catalog truth
source.

## K-MCAT-006 Local Custom Override Safety

Custom catalog override is local-file only and MUST NOT fetch provider metadata from remote discovery endpoints.
Any custom provider YAML ingestion MUST enforce:

- parse validation before activation
- last-known-good built-in snapshot fallback
- no startup dependency on mutable external metadata

## K-MCAT-006a User Overlay Merge Semantics

Custom catalog overlays MUST be stored as provider-scoped local fragments and merged at model granularity, not as full effective provider snapshots.

- built-in provider documents continue to load from `runtime/catalog/providers/*.yaml`
- custom overlay documents MAY exist in shared custom catalog roots and in user-scoped overlay roots
- effective provider state = built-in provider document + overlay upserts
- overlay entries with the same `model_id` MUST override the built-in model entry
- built-in models that are not mentioned by overlay fragments MUST remain visible and continue to receive built-in catalog upgrades
- user-created models and user-created overrides MUST be isolated to the requesting subject user and MUST NOT mutate other users' effective catalogs

## K-MCAT-006b Desktop Catalog Truth Source

Desktop catalog browsing and editing MUST use runtime model catalog truth resolved from `runtime/catalog/providers/*.yaml` plus overlay merge semantics.
`tables/provider-catalog.yaml` remains the projected remote-provider table and MUST NOT be treated as the desktop catalog page truth source.
Desktop catalog UX therefore MUST include providers that exist only in runtime model catalog truth, including `local`.

## K-MCAT-008 Fail-Close Semantics

When catalog lookup fails:

- unknown model -> `AI_MODEL_NOT_FOUND`
- unsupported voice -> `AI_MEDIA_OPTION_UNSUPPORTED`

Runtime MUST fail-close and MUST NOT silently fallback to legacy hardcoded voice lists for DashScope.

## K-MCAT-009 Compatibility Scope

`ListPresetVoices` gRPC surface remains unchanged in this phase. `catalog_source` is an internal/runtime diagnostic behavior and does not require proto breaking change.
