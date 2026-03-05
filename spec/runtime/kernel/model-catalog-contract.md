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
- `voices` (optional; required only when TTS-capable models exist)

`models[]` entries MUST include:

- `provider`
- `model_id`
- `model_type`
- `updated_at`
- `capabilities`
- `pricing`
- `source_ref`

`models[]` capability-conditional fields:

- when capability includes `tts` or `llm.speech.synthesize`: `voice_set_id` MUST be present.
- when capability includes `video_generation` or `llm.video.generate`: `video_generation` MUST be present.

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

## K-MCAT-011 Source Schema v3

`runtime/catalog/source/providers/*.source.yaml` 必须使用 schema v3。核心结构固定为：

- `models`
- `language_profiles`
- `sources`
- `voice_sets`（可选）
- `voice_workflow_models`（可选）
- `model_workflow_bindings`（可选）

## K-MCAT-012 Synthesis Model Anchor

`models` 仅描述“可合成模型”能力。TTS 模型必须显式声明 `voice` 能力块：

- `discovery_mode`（`static_catalog|dynamic_user_scoped|dynamic_global`）
- `supports_voice_ref_kinds`
- `voice_set_ref`（当 discovery 为 static 时）
- `langs_ref`

## K-MCAT-013 Workflow Model Contract

`voice_workflow_models` 必须显式声明创建音色模型能力：

- `workflow_model_id`
- `workflow_type`（`tts_v2v|tts_t2v`）
- `input_contract_ref`
- `output_persistence`
- `target_model_refs`
- `langs_ref`

## K-MCAT-014 Binding Matrix Contract

`model_workflow_bindings` 必须声明创建模型与合成模型兼容矩阵，禁止 provider 端隐式兼容关系。

## K-MCAT-015 Dual Language Profile

source schema 必须支持双轨语言配置：

- 区域码（如 `zh-cn`）
- 短码（如 `zh`）

两者并存时不得自动映射，映射策略必须显式声明。

## K-MCAT-016 ElevenLabs Source Profile

ElevenLabs provider source 必须使用 schema v3，并满足以下最小结构：

- `models`：仅列出可用于 `tts_synthesize` 的模型，`voice.discovery_mode` 建议使用 `dynamic_global` 并声明 `voice_asset_id` 支持。
- `voice_workflow_models`：至少包含
  - `elevenlabs-voice-clone`（`workflow_type=tts_v2v`，映射 `/v1/voices/add`）
  - `elevenlabs-voice-design`（`workflow_type=tts_t2v`，映射 `create-previews + create-voice-from-preview`）
- `model_workflow_bindings`：显式声明 workflow -> synthesis model 兼容矩阵。
- `voice_handle_policies`：默认 `provider_persistent + user_scoped`。

## K-MCAT-017 Dynamic Voice Snapshot Minimality

当 `voice.discovery_mode` 为动态模式（`dynamic_user_scoped|dynamic_global`）时，flattened snapshot 不得枚举 provider 全量动态音色。  
生成产物仅允许输出最小占位 voice（如 `user-custom` / `preset-dynamic`），真实 preset/custom voice 通过 runtime `ListPresetVoices` / `ListVoiceAssets` 在线发现。

## K-MCAT-018 Video Capability Block Contract

当 model 声明 `video_generation` 或 `llm.video.generate` 能力时，`video_generation` 能力块必须包含：

- `modes`
- `input_roles`
- `limits`
- `options`
- `outputs`

其中 `modes` 最小支持集合为：

- `t2v`
- `i2v_first_frame`
- `i2v_first_last`
- `i2v_reference`

`outputs` 必须显式声明 `video_url` 与 `last_frame_url` 可用性，不得依赖隐式 provider 文档推断。

## K-MCAT-019 Voice Optional for Video-Only Provider

对于仅提供视频能力（不含 `tts` / `llm.speech.synthesize`）的 provider：

- 不要求定义 `voice_set_id`
- 不要求定义 `voices[]`
- Runtime loader 与 consistency gate 不得因缺失 voice 映射而拒绝 catalog

## K-MCAT-020 Single Catalog Layout

Catalog source 与 snapshot 采用单一目录布局：

- source：`runtime/catalog/source/providers/*.source.yaml`
- snapshot：`runtime/catalog/providers/*.yaml`

Runtime 仅允许加载 `runtime/catalog/providers/*.yaml`。

## K-MCAT-021 Layered Provider Onboarding

Provider 纳入必须分层：

- `tts_synthesize` 是纳入基础门槛；
- `tts_v2v` / `tts_t2v` 属于可选能力增量；
- 仅支持 synthesize 的 provider 不得被强制声明 `voice_workflow_models`；
- 云厂训练型 Custom Voice（长周期训练）在未形成跨 provider 强类型抽象前，必须标记为 deferred/provider extension。

## K-MCAT-022 Activation Guardrail

Catalog source 可以维护尚未接入 runtime adapter 的 provider 条目。  
Runtime 实际可用性以 runtime loader 支持集与 provider adapter 实现为准，未接入实现的 provider 不得被路由执行。

## K-MCAT-023 TTS Provider Capability Matrix SSOT

`tables/tts-provider-capability-matrix.yaml` 是主流 TTS provider 运行平面（remote/local）与能力分层（synthesize/v2v/t2v/timing/discovery mode）的结构化事实源。
