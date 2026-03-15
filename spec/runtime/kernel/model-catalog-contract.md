# Runtime Model Catalog Contract

> Owner Domain: `K-MCAT-*`

## K-MCAT-001 SSOT Location

Runtime model/voice schema and behavior rules are defined in this contract (`K-MCAT-*`).
Runtime default data MUST be loaded from `runtime/catalog/providers/*.yaml` (provider-scoped files), not from `spec/runtime/kernel/tables/*`.
`runtime/catalog/source/providers/*.source.yaml` is the authoring SSOT for source-provider metadata, including endpoint/runtime facts that are later projected into snapshot / registry / spec tables.
`tables/provider-catalog.yaml` is the projected remote-endpoint table for remote providers and therefore intentionally excludes `local`.

## K-MCAT-002 Field Schema

Each provider file in `runtime/catalog/providers/*.yaml` MUST include:

- `version`
- `provider`
- `catalog_version`
- `default_text_model` (optional; remote text-capable providers only)
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

- when capability includes `audio.synthesize`: `voice_set_id` MUST be present.
- when capability includes `video.generate`: `video_generation` MUST be present.

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

Remote metadata cache / refresh MUST NOT exist as a non-scenario catalog source.

## K-MCAT-006 Local Custom Override Safety

Custom catalog override is local-file only and MUST NOT fetch provider metadata from remote discovery endpoints.
Any custom provider YAML ingestion MUST enforce:

- parse validation before activation
- last-known-good built-in snapshot fallback
- no startup dependency on mutable external metadata

## K-MCAT-006A User Overlay Merge Semantics

Custom catalog overlays MUST be stored as provider-scoped local fragments and merged at model granularity, not as full effective provider snapshots.

- built-in provider documents continue to load from `runtime/catalog/providers/*.yaml`
- custom overlay documents MAY exist in shared custom catalog roots and in user-scoped overlay roots
- effective provider state = built-in provider document + overlay upserts
- overlay entries with the same `model_id` MUST override the built-in model entry
- built-in models that are not mentioned by overlay fragments MUST remain visible and continue to receive built-in catalog upgrades
- user-created models and user-created overrides MUST be isolated to the requesting subject user and MUST NOT mutate other users' effective catalogs

## K-MCAT-006B Desktop Catalog Truth Source

Desktop catalog browsing and editing MUST use runtime model catalog truth resolved from `runtime/catalog/providers/*.yaml` plus overlay merge semantics.
`tables/provider-catalog.yaml` remains the projected remote-provider table and MUST NOT be treated as the desktop catalog page truth source.
Desktop catalog UX therefore MUST include providers that exist only in runtime model catalog truth, including `local`.

## K-MCAT-007 DashScope Voice Path

For DashScope TTS models, `ListPresetVoices` and TTS voice validation MUST be catalog-driven. OpenAI-compatible voice discovery endpoint probing MUST NOT be the primary resolution path.

## K-MCAT-008 Fail-Close Semantics

When catalog lookup fails:

- unknown model -> `AI_MODEL_NOT_FOUND`
- unsupported voice -> `AI_MEDIA_OPTION_UNSUPPORTED`

Runtime MUST fail-close and MUST NOT silently fallback to legacy hardcoded voice lists for DashScope.

## K-MCAT-009 Compatibility Scope

`ListPresetVoices` gRPC surface remains unchanged in this phase. `catalog_source` is an internal/runtime diagnostic behavior and does not require proto breaking change.

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

`models` 仅描述“可合成模型”能力。`audio.synthesize` 模型必须显式声明 `voice` 能力块：

- `discovery_mode`（`static_catalog|dynamic_user_scoped`）
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

- `models`：仅列出可用于 `audio.synthesize` 的模型，provider-global preset voices 必须以 `static_catalog` + `voice_set_ref` 方式枚举。
- `voice_workflow_models`：至少包含
  - `elevenlabs-voice-clone`（`workflow_type=tts_v2v`，映射 `/v1/voices/add`）
  - `elevenlabs-voice-design`（`workflow_type=tts_t2v`，映射 `create-previews + create-voice-from-preview`）
- `model_workflow_bindings`：显式声明 workflow -> synthesis model 兼容矩阵。
- `voice_handle_policies`：默认 `provider_persistent + user_scoped`。

## K-MCAT-017 Dynamic User Voice Snapshot Minimality

当 `voice.discovery_mode` 为 `dynamic_user_scoped` 时，flattened snapshot 不得枚举 provider 全量动态用户音色。  
生成产物仅允许输出最小占位 voice（如 `user-custom`），真实 custom voice 通过 runtime `ListVoiceAssets` 在线发现。

## K-MCAT-018 Video Capability Block Contract

当 model 声明 `video.generate` 能力时，`video_generation` 能力块必须包含：

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

对于仅提供视频能力（不含 `audio.synthesize`）的 provider：

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

- `audio.synthesize` 是纳入基础门槛；
- `voice_workflow.tts_v2v` / `voice_workflow.tts_t2v` 属于可选能力增量；
- 仅支持 synthesize 的 provider 不得被强制声明 `voice_workflow_models`；
- 云厂训练型 Custom Voice（长周期训练）在未形成跨 provider 强类型抽象前，必须标记为 deferred/provider extension。

## K-MCAT-022 Activation Guardrail

Catalog source 不得将未接入 runtime adapter 的 capability 或 workflow binding 标记为 active。  
Runtime 实际可用性必须与 source/snapshot 激活面一致；未接入实现的 provider/capability/workflow 不得被 source 声明，也不得被路由执行。

## K-MCAT-023 TTS Provider Capability Matrix SSOT

`tables/tts-provider-capability-matrix.yaml` 是主流 TTS provider 运行平面（remote/local）与能力分层（synthesize/v2v/t2v/timing/discovery mode）的结构化事实源。

## K-MCAT-024 Canonical Capability Vocabulary

source、snapshot、registry、resolver、scenario guard、live-provider checks 必须只使用以下 canonical capability token：

- `text.generate`
- `text.embed`
- `image.generate`
- `video.generate`
- `audio.synthesize`
- `audio.transcribe`
- `music.generate`
- `music.generate.iteration`
- `voice_workflow.tts_v2v`
- `voice_workflow.tts_t2v`

`chat`、`embedding`、`image`、`tts`、`stt`、`video_generation`、`llm.text.generate`、`llm.embed`、`llm.image.generate`、`llm.video.generate`、`llm.speech.synthesize`、`llm.speech.transcribe` 不得作为有效 capability 声明值继续存在于 source 或 snapshot 中。

local runtime 若仍使用 `chat` / `embedding` / `tts` 等本地 token，必须先通过 `tables/capability-vocabulary-mapping.yaml` 做 local → canonical 转换，再进入 source/snapshot/resolver/guard 语义面。

## K-MCAT-025 Source Provider / Infra Provider Boundary

`runtime/catalog/source/providers/*.source.yaml` 仅定义 source provider SSOT。  
`nimillm`、`openai_compatible`、`volcengine_openspeech` 属于 runtime 基础设施 provider，只能在 runtime registry / routing 层存在，不得伪装成 source provider 能力声明。

## K-MCAT-026 STT Modeling And Local Workflow Exclusion

`audio.transcribe` 只允许在已经完成 runtime 审核并具备真实执行路径的 source provider 上声明。  
未完成审核的 source provider 必须 fail-close，不得通过 infra provider 语义隐式承接为“已支持”。

`local` 在真实本地 voice workflow 引擎接入前，必须保持 synthesize-only：不得声明 `voice_workflow_models`、`model_workflow_bindings` 或对应 workflow capability。

## K-MCAT-027 Provider Runtime Metadata Projection

source provider 的非 scenario 元数据必须通过 `runtime/catalog/source/providers/*.source.yaml` 顶层 `runtime` 块维护，最少包括：

- `runtime_plane`
- `managed_connector_supported`
- `inline_supported`
- `default_endpoint`
- `requires_explicit_endpoint`

provider 默认文本模型元数据必须通过同一份 source provider SSOT 的 `defaults.default_text_model` 维护。

`runtime/internal/providerregistry/generated.go`、`tables/provider-catalog.yaml`、`tables/provider-capabilities.yaml` 都必须由该 source metadata 投影生成，禁止 spec 表反向充当 runtime endpoint/default endpoint/default text model 真相。

## Verification Anchors

- `K-MCAT-005` / `K-MCAT-006` / `K-MCAT-007`：`pnpm check:runtime-catalog-drift`、`pnpm check:runtime-provider-yaml-first-hardcut`
- `K-MCAT-018`：`pnpm check:runtime-video-capability-block-enforcement`
- `K-MCAT-022`：`pnpm check:runtime-provider-activation-alignment`
- `K-MCAT-024`：`pnpm check:runtime-provider-capability-token-canonicalization`
- `K-MCAT-027`：`pnpm check:runtime-provider-endpoint-ssot`
