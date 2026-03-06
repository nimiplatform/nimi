# Catalog Source README

## 1. Purpose

`runtime/catalog/source/` stores human-maintained source catalogs.
`runtime/catalog/providers/*.yaml` stores runtime-consumed flattened active snapshots.

Source is optimized for long-term editing.
Provider snapshot is optimized for runtime resolver compatibility.

## 2. Catalog Layout

- Source: `runtime/catalog/source/providers/*.source.yaml`
- Snapshot: `runtime/catalog/providers/*.yaml`

Runtime only loads `runtime/catalog/providers/*.yaml`.

`spec/runtime/kernel/tables/provider-catalog.yaml` and
`spec/runtime/kernel/tables/provider-capabilities.yaml` are generated mirrors of
source-provider runtime metadata. Runtime routing facts must be authored here
first, then projected into snapshot / registry / spec tables.

## 3. Schema Versioning

- `schema_version: 3` is required.
- v3 unifies model definitions for both speech and video generation.

## 4. v3 Core Structure

Each `*.source.yaml` should contain:

- `schema_version`
- `provider`
- `catalog_version`
- `generated_target`
- `runtime`
- `defaults`
- `sources`
- `language_profiles`
- `voice_sets` (optional)
- `models`
- `voice_workflow_models` (optional)
- `model_workflow_bindings` (optional)
- `voice_handle_policies` (optional)

Source-provider SSOT covers the 39 source providers only.
Infrastructure bridge providers such as `nimillm`, `openai_compatible`, and `volcengine_openspeech` are runtime-layer implementation details and are not authored here.

## 5. Design Rules

### 5.1 Unified Model Table

`models` is the single source of truth for all modalities.

Required model-level fields:

- `model_id`
- `updated_at`
- `capabilities`

Optional model-level capability blocks:

- `voice` (for `audio.synthesize` models)
- `video_generation` (for `video.generate` models)

Canonical capability tokens are:

- `text.generate`
- `text.embed`
- `image.generate`
- `video.generate`
- `audio.synthesize`
- `audio.transcribe`
- `voice_workflow.tts_v2v`
- `voice_workflow.tts_t2v`

Legacy capability synonyms such as `chat`, `embedding`, `image`, `tts`, `stt`, `video_generation`, `llm.text.generate`, `llm.embed`, `llm.image.generate`, `llm.video.generate`, `llm.speech.synthesize`, and `llm.speech.transcribe` are not valid source declarations.

### 5.1a Runtime Metadata Rule

`runtime` is the YAML SSOT for non-scenario provider metadata:

- `runtime_plane` (`local|remote`)
- `managed_connector_supported`
- `inline_supported`
- `default_endpoint`
- `requires_explicit_endpoint`

These fields drive:

- `runtime/internal/providerregistry/generated.go`
- `spec/runtime/kernel/tables/provider-catalog.yaml`
- `spec/runtime/kernel/tables/provider-capabilities.yaml`

Remote providers must choose exactly one endpoint policy:

- `default_endpoint` set + `requires_explicit_endpoint=false`
- `default_endpoint=null` + `requires_explicit_endpoint=true`

`local` must keep `default_endpoint=null` and `requires_explicit_endpoint=false`.

### 5.2 Voice Capability Rule

When a model declares `audio.synthesize`, `voice` must be defined:

- `discovery_mode` (`static_catalog|dynamic_user_scoped`)
- `voice_set_ref` (required when `static_catalog`)
- `supports_voice_ref_kinds`
- `langs_ref`

### 5.3 Discovery Semantics

- `static_catalog`: preset voices are fully enumerated in source and flattened snapshot.
- `dynamic_user_scoped`: runtime `ListVoiceAssets` is authoritative for user-owned dynamic voices.

Provider-global preset voices must be represented as `static_catalog`.
`ListPresetVoices` is a catalog read, not provider live discovery.

### 5.4 Video Capability Rule

When a model declares `video.generate`, `video_generation` must be defined:

- `modes` (`t2v|i2v_first_frame|i2v_first_last|i2v_reference`)
- `input_roles` (mode -> legal role combinations)
- `limits`
- `options`
- `outputs`

### 5.5 Voice Set Rule

`voice_sets` only stores preset/system voices.
Custom user voices are represented by `dynamic_user_scoped` and generated as synthetic placeholder rows.

Provider-native multi-step create-voice flows (for example preview -> create) must be modeled as one workflow model and stay internal to provider adapter orchestration.

### 5.6 Language Profile Rule

`language_profiles` supports dual tracks:

- region code profile (e.g. `zh-cn`)
- short code profile (e.g. `zh`)

No automatic mapping is assumed.

### 5.7 Dynamic User Voice Snapshot Rule

For `discovery_mode=dynamic_user_scoped`:

- source must not enumerate full dynamic provider voice inventory;
- flattened snapshot should keep only minimal placeholder rows;
- runtime `ListVoiceAssets` remains the authority for real-time user voice inventory.

### 5.8 Voice Workflow Rule

If `voice_workflow_models` is provided, each entry should define:

- `workflow_model_id`
- `workflow_type` (`tts_v2v|tts_t2v`)
- `input_contract_ref`
- `output_persistence`
- `target_model_refs`
- `langs_ref`

`model_workflow_bindings` should explicitly map synthesis model ids to compatible workflow model ids.

Only providers with a real runtime voice-workflow adapter may declare workflow models and bindings.
`local` is currently synthesize-only and must not declare voice workflows until a real local workflow engine is integrated.

### 5.9 Latest-Only + Alias Compatibility Rule

For cloud providers, source catalogs should prioritize latest canonical models:

- Keep one canonical model id per actively maintained capability track.
- Add aliases only when the alias is officially documented and verifiable.
- Do not create speculative aliases.
- Older model generations should only be carried forward as explicit compatibility aliases, not as separately maintained primary entries.

## 6. Validation Requirements

At minimum, generator/schema validation must enforce:

1. Canonical model id uniqueness.
2. Alias uniqueness across all models.
3. `source_ids` targets exist.
4. Capability declarations must use canonical capability tokens only.
5. `audio.synthesize` models must produce valid voice mappings.
6. `video.generate` capability models must define non-empty `modes`.
7. `video_generation` must include `input_roles/limits/options/outputs` objects.
8. Providers that declare `voice_workflow_models` must also have a routable runtime voice adapter.
9. `voice.discovery_mode` must be one of `static_catalog|dynamic_user_scoped`.
10. `runtime` metadata must fully determine endpoint/default endpoint and runtime plane facts.

## 7. Workflow

1. Edit source at `runtime/catalog/source/providers/<provider>.source.yaml`.
2. Validate source schema + semantic rules.
3. Generate snapshots: `pnpm generate:runtime-catalog`.
4. Generate registry + projected spec tables: `pnpm generate:runtime-provider-registry`.
5. Keep source and generated snapshots synchronized.

Drift check commands:

- `pnpm check:runtime-catalog-drift`
- `pnpm check:runtime-provider-yaml-first-hardcut`
- `pnpm check:runtime-provider-endpoint-ssot`

## 8. Non-goals

- Do not encode runtime fallback logic in source files.
- Do not hand-maintain flattened snapshots long-term.
- Do not use provider live metadata discovery as a non-scenario source of truth.
