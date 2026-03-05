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

## 3. Schema Versioning

- `schema_version: 3` is required.
- v3 unifies model definitions for both speech and video generation.

## 4. v3 Core Structure

Each `*.source.yaml` should contain:

- `schema_version`
- `provider`
- `catalog_version`
- `generated_target`
- `defaults`
- `sources`
- `language_profiles`
- `voice_sets` (optional)
- `models`
- `voice_workflow_models` (optional)
- `model_workflow_bindings` (optional)
- `voice_handle_policies` (optional)

## 5. Design Rules

### 5.1 Unified Model Table

`models` is the single source of truth for all modalities.

Required model-level fields:

- `model_id`
- `updated_at`
- `capabilities`

Optional model-level capability blocks:

- `voice` (for tts-capable models)
- `video_generation` (for video-capable models)

### 5.2 Voice Capability Rule

When a model declares `tts`/`llm.speech.synthesize`, `voice` must be defined:

- `discovery_mode` (`static_catalog|dynamic_user_scoped|dynamic_global`)
- `voice_set_ref` (required when `static_catalog`)
- `supports_voice_ref_kinds`
- `langs_ref`

### 5.3 Discovery Semantics

- `static_catalog`: preset voices are fully enumerated in source and flattened snapshot.
- `dynamic_user_scoped`: runtime `ListVoiceAssets` is authoritative for user-owned dynamic voices.
- `dynamic_global`: runtime `ListPresetVoices` is authoritative for provider-global dynamic preset voices.

### 5.4 Video Capability Rule

When a model declares `video_generation`/`llm.video.generate`, `video_generation` must be defined:

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

### 5.7 Dynamic Voice Snapshot Rule

For `discovery_mode=dynamic_user_scoped`:

- source must not enumerate full dynamic provider voice inventory;
- flattened snapshot should keep only minimal placeholder rows;
- runtime `ListVoiceAssets` remains the authority for real-time user voice inventory.

For `discovery_mode=dynamic_global`:

- source must not enumerate full provider global voice inventory;
- flattened snapshot should keep only minimal placeholder rows;
- runtime `ListPresetVoices` remains the authority for real-time provider preset voice inventory.

### 5.8 Voice Workflow Rule

If `voice_workflow_models` is provided, each entry should define:

- `workflow_model_id`
- `workflow_type` (`tts_v2v|tts_t2v`)
- `input_contract_ref`
- `output_persistence`
- `target_model_refs`
- `langs_ref`

`model_workflow_bindings` should explicitly map synthesis model ids to compatible workflow model ids.

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
4. `tts` capability models must produce valid voice mappings.
5. `video_generation` capability models must define non-empty `modes`.
6. `video_generation` must include `input_roles/limits/options/outputs` objects.
7. `voice.discovery_mode` must be one of `static_catalog|dynamic_user_scoped|dynamic_global`.

## 7. Workflow

1. Edit source at `runtime/catalog/source/providers/<provider>.source.yaml`.
2. Validate source schema + semantic rules.
3. Generate snapshots: `pnpm generate:runtime-catalog`.
4. Keep source and generated snapshots synchronized.

Drift check commands:

- `pnpm check:runtime-catalog-drift`

## 8. Non-goals

- Do not encode runtime fallback logic in source files.
- Do not hand-maintain flattened snapshots long-term.
