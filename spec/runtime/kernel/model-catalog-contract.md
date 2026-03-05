# Runtime Model Catalog Contract

> Owner Domain: `K-MCAT-*`

## K-MCAT-001 SSOT Location

Runtime model/voice schema and behavior rules are defined in this contract (`K-MCAT-*`).
Runtime default data MUST be loaded from `runtime/catalog/providers/*.yaml` (provider-scoped files), not from `spec/runtime/kernel/tables/*`.

## K-MCAT-002 Field Schema

Each provider file in `runtime/catalog/providers/*.yaml` MUST include:

- `version`
- `provider`
- `catalog_version`
- `models`
- `voices`

`models[]` entries MUST include:

- `provider`
- `model_id`
- `model_type`
- `updated_at`
- `capabilities`
- `pricing`
- `voice_set_id`
- `source_ref`

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

## K-MCAT-004 Source Traceability

Every model and voice entry MUST include `source_ref` with authoritative provider documentation URL and `retrieved_at` date.

## K-MCAT-005 Runtime Resolution Order

Runtime catalog resolution order MUST be:

1. Built-in snapshot (required)
2. Local custom provider directory (`modelCatalogCustomDir`) (optional)
3. Remote override cache (optional, when enabled)

Remote refresh MUST NOT be a startup dependency.

## K-MCAT-006 Remote Override Safety

Remote override is opt-in and MUST default to disabled. Enabled remote fetch MUST enforce:

- HTTPS only
- payload size bound
- ETag conditional fetch
- parse-failure retain-last-known-good

## K-MCAT-007 DashScope Voice Path

For DashScope TTS models, `GetSpeechVoices` and TTS voice validation MUST be catalog-driven. OpenAI-compatible voice discovery endpoint probing MUST NOT be the primary resolution path.

## K-MCAT-008 Fail-Close Semantics

When catalog lookup fails:

- unknown model -> `AI_MODEL_NOT_FOUND`
- unsupported voice -> `AI_MEDIA_OPTION_UNSUPPORTED`

Runtime MUST fail-close and MUST NOT silently fallback to legacy hardcoded voice lists for DashScope.

## K-MCAT-009 Compatibility Scope

`GetSpeechVoices` gRPC surface remains unchanged in this phase. `catalog_source` is an internal/runtime diagnostic behavior and does not require proto breaking change.

## K-MCAT-010 DashScope First Rollout

Phase-1 mandatory coverage:

- `qwen3-tts-instruct-flash`
- `qwen3-tts-instruct-flash-2026-01-26`
- `qwen3-tts-flash` family entries

DashScope published voices for these models MUST be represented in `runtime/catalog/providers/dashscope.yaml`.
