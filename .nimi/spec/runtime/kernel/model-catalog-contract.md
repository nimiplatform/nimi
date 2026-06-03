# Runtime Model Catalog Contract

> Owner Domain: `K-MCAT-*`

## K-MCAT-001 SSOT Location

Runtime model/voice schema and behavior rules are defined in this contract (`K-MCAT-*`).
Runtime default data MUST be loaded from `runtime/catalog/providers/*.yaml` (provider-scoped files), not from `.nimi/spec/runtime/kernel/tables/*`.
`runtime/catalog/source/providers/*.source.yaml` is the authoring SSOT for source-provider metadata, including endpoint/runtime facts that are later projected into snapshot / registry / spec tables.
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

- `runtime`
- `models`
- `language_profiles`
- `sources`
- `voice_sets`（可选）
- `voice_workflow_models`（可选）
- `model_workflow_bindings`（可选）

其中：

- `runtime.inventory_mode` 必填，值域为 `static_source|dynamic_endpoint`
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`runtime.dynamic_inventory`
  必填
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`models`、`selection_profiles`
  与 `defaults.default_text_model` 都可以省略

## K-MCAT-012 Synthesis Model Anchor

`models` 仅描述“可合成模型”能力。`audio.synthesize` 模型必须显式声明 `voice` 能力块：

- `discovery_mode`（`static_catalog|dynamic_user_scoped|mixed`）
- `supports_voice_ref_kinds`
- `voice_set_ref`（当 discovery 包含 `static_catalog` 通道时）
- `langs_ref`

## K-MCAT-013 Workflow Model Contract

`voice_workflow_models` 必须显式声明创建音色模型能力：

- `workflow_model_id`
- `workflow_type`（`voice_clone|voice_design`）
- `input_contract_ref`
- `output_persistence`
- `target_model_refs`
- `langs_ref`

若 `request_options.provider_extensions` 被声明，它只承载 extension
namespace/schema identity，用于 route describe / consumer-facing metadata
identity 投影。workflow extension 的具体 transport override key allowlist
（例如 endpoint/header/path 覆写键）不得在 source catalog 中升格为
canonical truth；若未来需要 source-authored key truth，必须另起 authority
cut。

## K-MCAT-014 Binding Matrix Contract

`model_workflow_bindings` 必须声明创建模型与合成模型兼容矩阵，禁止 provider 端隐式兼容关系。

`model_workflow_bindings` 也是 workflow -> target synthesis compatibility 的 authority home：

- workflow family 是否需要 target synthesis binding，必须由 binding truth 显式表达
- 若 binding truth 要求 target synthesis model，则 runtime `resolve / describe / checkHealth` 都必须显式消费该矩阵
- local/cloud 跨 plane 复用默认不成立；若要 admitted，必须由 authority 显式声明，而不是由 runtime/SDK/Desktop 猜测
- 当 local workflow execution 进入 first-family admission 时，binding truth 仍必须保持 family-scoped，而不是 generic `local speech` scoped：
  - baseline admitted family 当前固定为 `qwen3_tts`
  - 其 workflow binding 固定收敛到 admitted `Qwen3-TTS` synth/workflow line，而不是 generic `speech`
  - 其它 local workflow family（包括 `voxcpm`、`omnivoice`）不得因为共享 `speech` engine 或共享 workflow object truth 而被隐式视为 admitted

## K-MCAT-014a Desktop Local Speech Bundle Consumption

runtime catalog / local admission truth for baseline local speech 必须继续保持 family-scoped 与 row-scoped：

- `Qwen3-ASR` 仍是 admitted local `STT` family line
- `Qwen3-TTS` synth / workflow rows 仍是 admitted local `qwen3_tts` family line
- workflow binding truth 继续锚定在 admitted `Qwen3-TTS` synth/workflow line，而不是 generic `speech`

desktop 可以把这些 admitted rows 消费为 ordinary-user `Local Speech` bundle projection，但必须满足：

- bundle projection 只能读取/组合 runtime catalog truth 与 runtime-owned asset/service truth；不得新增第二套 bundle catalog、bundle row 或 generic local speech marketplace truth。
- `qwen3_asr` 与 `qwen3_tts` 不得因为 desktop bundle 语义而被压扁成单一 canonical install row。
- 显式 `Download`、env/bootstrap、host readiness、capability materialization 的 ordinary-user 产品语义必须服从 `K-LENG-*` 与 `K-LOCAL-*`；catalog 不得被 Desktop/Tauri helper 反向改写成 install truth owner。
- bundle projection 的 admitted scope 仍固定为 baseline local speech；不得借此把其它 speech family 或 generic speech marketplace 扩写为 canonical truth。

## K-MCAT-015 Dual Language Profile

source schema 必须支持双轨语言配置：

- 区域码（如 `zh-cn`）
- 短码（如 `zh`）

两者并存时不得自动映射，映射策略必须显式声明。

## K-MCAT-016 ElevenLabs Source Profile

ElevenLabs provider source 必须使用 schema v3，并满足以下最小结构：

- `models`：仅列出可用于 `audio.synthesize` 的模型，provider-global preset voices 必须以 `static_catalog` + `voice_set_ref` 方式枚举。
- `voice_workflow_models`：至少包含
  - `elevenlabs-voice-clone`（`workflow_type=voice_clone`，映射 `/v1/voices/add`）
  - `elevenlabs-voice-design`（`workflow_type=voice_design`，映射 `create-previews + create-voice-from-preview`）
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

`input_roles` 是按 mode 建模的“允许角色集合” authority；它用于声明该 model 在对应 mode 下可接受的 canonical role token。
runtime 校验必须同时满足：

- mode 级最小必需角色约束（见 `K-MMPROV-024`）
- 请求中的每个实际 role 都属于该 mode 的 `input_roles` 允许集合
- provider/model 特定的数量上限由 `limits` 约束，而不是由 `input_roles` 的存在性隐式推断

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
- `voice_workflow.voice_clone` / `voice_workflow.voice_design` 属于可选能力增量；
- 仅支持 synthesize 的 provider 不得被强制声明 `voice_workflow_models`；
- 云厂训练型 Custom Voice（长周期训练）在未形成跨 provider 强类型抽象前，必须标记为 deferred/provider extension。

## K-MCAT-022 Activation Guardrail

Catalog source 不得将未接入 runtime adapter 的 capability 或 workflow binding 标记为 active。  
Runtime 实际可用性必须与 source/snapshot 激活面一致；未接入实现的 provider/capability/workflow 不得被 source 声明，也不得被路由执行。

## K-MCAT-023 TTS Provider Capability Matrix SSOT

`tables/tts-provider-capability-matrix.yaml` 是主流 TTS provider 运行平面（remote/local）与能力分层（synthesize/voice_clone/voice_design/timing/discovery mode）的结构化事实源。

## K-MCAT-024 Canonical Capability Vocabulary

source、snapshot、registry、resolver、scenario guard、live-provider checks 必须只使用以下 canonical capability token：

- `text.generate`
- `text.generate.vision`
- `text.generate.audio`
- `text.generate.video`
- `text.embed`
- `image.generate`
- `image.edit`
- `video.generate`
- `world.generate`
- `audio.synthesize`
- `audio.transcribe`
- `music.generate`
- `music.generate.iteration`
- `voice_workflow.voice_clone`
- `voice_workflow.voice_design`

`chat`、`embedding`、`image`、`tts`、`stt`、`video_generation`、`speech.synthesize`、`tts.synthesize`、`voice.clone`、`voice.design`、`llm.text.generate`、`llm.embed`、`llm.image.generate`、`llm.video.generate`、`llm.speech.synthesize`、`llm.speech.transcribe` 不得作为有效 capability 声明值继续存在于 source、snapshot、fixture、registry、resolver、scenario guard 或 live-provider checks 中。

local runtime 若仍使用 `chat` / `embedding` / `tts` 等本地 token，必须先通过 `tables/capability-vocabulary-mapping.yaml` 做 local → canonical 转换，再进入 source/snapshot/resolver/guard 语义面。

## K-MCAT-025 Source Provider / Infra Provider Boundary

`runtime/catalog/source/providers/*.source.yaml` 仅定义 source provider SSOT。  
`nimillm`、`openai_compatible`、`volcengine_openspeech` 属于 runtime 基础设施 provider，只能在 runtime registry / routing 层存在，不得伪装成 source provider 能力声明。

## K-MCAT-026 STT Modeling And Local Workflow Exclusion

`audio.transcribe` 只允许在已经完成 runtime 审核并具备真实执行路径的 source provider 上声明。  
未完成审核的 source provider 必须 fail-close，不得通过 infra provider 语义隐式承接为“已支持”。

`local` 在 generic 本地 voice workflow execution plane 尚未 admitted 前，不得把 local workflow 声明成 generic green state。

例外：

- 当 authority 已通过独立规则显式 admitted first local workflow family 时，`local` 可以仅按该 family-scoped boundary 声明对应的：
  - `voice_workflow_models`
  - `model_workflow_bindings`
  - `voice_handle_policies`
  - 对应 workflow capability truth

约束：

- 该声明必须严格受 admitted family boundary 限定，不得被扩写成 generic local workflow success。
- 当前 first admitted local workflow family boundary 以 `K-VOICE-017` 为准。

对 local speech catalog row，`ready=true` 只允许在 admitted plain-speech proof 成立后出现；row capability 必须与 admitted capability truth 一致，non-ready row 或 placeholder row 不得被 route/model health 提升为 capability success。

## K-MCAT-027 Provider Runtime Metadata Projection

source provider 的非 scenario 元数据必须通过 `runtime/catalog/source/providers/*.source.yaml` 顶层 `runtime` 块维护，最少包括：

- `runtime_plane`
- `managed_connector_supported`
- `inline_supported`
- `default_endpoint`
- `requires_explicit_endpoint`
- `inventory_mode`

当 `inventory_mode=dynamic_endpoint` 时，source 还必须声明
`runtime.dynamic_inventory`，至少包括：

- `discovery_transport`
- `cache_ttl_sec`
- `selection_mode`
- `failure_policy`

provider 默认文本模型元数据只对 `inventory_mode=static_source` provider
继续由同一份 source provider SSOT 的 `defaults.default_text_model` 维护。

`runtime/internal/providerregistry/generated.go`、`tables/provider-catalog.yaml`、`tables/provider-capabilities.yaml` 都必须由该 source metadata 投影生成，禁止 spec 表反向充当 runtime endpoint/default endpoint/default text model 真相。

当 `inventory_mode=static_source` 且 source 已声明 `selection_profiles[text.general]` 时：

- reviewed text default truth 属于 `selection_profiles[text.general]`
- snapshot / registry `default_text_model` 只是 compatibility projection
- 过渡期允许 `defaults.default_text_model` 作为同值兼容字段保留
- 若 `selection_profiles[text.general]` 与 `defaults.default_text_model` 不一致，generator 与 freshness gate 都必须 fail-close

当 `inventory_mode=dynamic_endpoint` 时：

- snapshot / registry 仍必须投影 provider-level runtime metadata
- snapshot 可以不包含静态 `models`
- runtime `ListConnectorModels` 真相来自 live connector discovery，经
  source-authored dynamic inventory policy 过滤后返回
- `default_text_model` 与 `selection_profiles` 不再是 machine-default fallback
  truth
- 若 config `provider.defaultModel` 与 UI/route-selected live model 都缺失，
  runtime 必须 fail-close，并返回可执行 action hint

## Verification Anchors

- `K-MCAT-005` / `K-MCAT-006` / `K-MCAT-007`：`pnpm check:runtime-catalog-drift`、`pnpm check:runtime-provider-yaml-first-hardcut`
- `K-MCAT-018`：`pnpm check:runtime-video-capability-block-enforcement`
- `K-MCAT-022`：`pnpm check:runtime-provider-activation-alignment`
- `K-MCAT-024`：`pnpm check:runtime-provider-capability-token-canonicalization`
- `K-MCAT-027`：`pnpm check:runtime-provider-endpoint-ssot`
- `K-MCAT-030`：`pnpm check:runtime-selection-freshness`

## K-MCAT-028 Voice Handle Policy Contract

当 source provider 声明 `voice_workflow_models` 时，若该 workflow 可产出可复用 handle / asset truth，则 source 必须显式声明 `voice_handle_policies`。

`voice_handle_policies` 至少回答：

- `persistence`
- `scope`
- `default_ttl`
- `delete_semantics`
- `runtime_reconciliation_required`

未声明 `voice_handle_policies` 的 workflow-capable provider/family 不得被 source/snapshot 标记为 active。

## K-MCAT-029 Workflow Family Validation Discipline

workflow-capable speech family 的 source/catalog admission与验收必须保持 family-level discipline：

- workflow-capable TTS family 可同时覆盖 `audio.synthesize` 与 `voice_workflow.*`
- 但不得因此被当成 `audio.transcribe` 的替代验收对象

如果某一 speech family 不提供真实 STT execution path，则 source/snapshot/runtime validation 不得把该 family 的成功结果提升为 speech 全链路成功。

## K-MCAT-030 Reviewed Selection Profiles And Speech Option Metadata

source provider SSOT 可以声明两类受控扩展 truth：

1. provider-level `selection_profiles`
2. model-level `voice.request_options` / `transcription`

约束如下：

- `selection_profiles` 必须 source-authored、reviewed、并声明 `reviewed_at + freshness_sla_days`
- `selection_profiles` 只能引用同 provider 下已存在、且 capability 匹配的 model
- `voice.request_options` 只能出现在 `audio.synthesize` model 上
- `transcription` 只能出现在 `audio.transcribe` model 上
- runtime route describe metadata 只能单向派生自这些 source-authored fields，不得由 Desktop/SDK/provider live probing 生成第二份语义真相

## K-MCAT-031 Baseline Local Qwen Speech Freeze

baseline local live chat voice bundle 的 source/catalog freeze 固定如下：

- default local `STT` lane:
  - `Qwen3-ASR-0.6B`
- optional premium `STT` candidate:
  - `Qwen3-ASR-1.7B`
  - 但在独立 premium admission 前继续保持 deferred，不得自动视为已 admitted
- default local plain synth lane:
  - `Qwen3-TTS-12Hz-0.6B-CustomVoice`
- default local clone workflow lane:
  - `Qwen3-TTS-12Hz-0.6B-Base`
- default local design workflow lane:
  - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`

约束：

- 上述 freeze 是 baseline admitted default mapping，而不是 generic `Qwen3`
  family 自动覆盖规则
- local source/snapshot/binding truth 必须显式表达 plain synth / clone /
  design 三者的 subrole，不得只写成一个模糊的 `qwen3-tts` bucket
- baseline local install/bootstrap truth 必须显式允许 split env topology：
  `Qwen3-TTS` synth/workflow line 与 `Qwen3-ASR` line 不得被隐式压成一个 shared
  canonical Python env
- cloud plain `TTS` 是否同步迁移到 `qwen3-tts-*` 不属于本规则自动推出的结果；
  若要调整，必须由独立 reviewed source/default truth 显式声明

## K-MCAT-032 Local-Plane Row Block

每个 `runtime.runtime_plane: local` provider 的 `models[]` row 必须携带一个
local-plane block。它是 `K-MCAT-002` capability-conditional 字段模式的 plane-
conditional 延伸（与 `video_generation` / `voice` block 同类），不是 schema fork。

local-plane block 的固定结构为：

- `install`（必填）：可安装事实
  - `repo`：HuggingFace repo
  - `revision`：pinned revision
  - `install_kind`：值域固定为 `binary` / `weights` / `verified-hf-multi-file`
  - `entry`：引擎入口 artifact，相对路径
  - `artifact_roles`：bundle 角色集合
  - `preferred_engine`：值域固定为 `llama` / `media` / `speech` / `sidecar`
- `variants`（必填，1+）：量化变体列表，每个变体为一个独立可安装资产
  - `variant_id`：稳定 per-`(model, quant)` 标识；它是 **installable identity**
  - `quant`：量化标识（如 `Q4_K_M` / `Q8_0` / `F16`）
  - `files`：组成文件列表
  - `hashes`：`{<file>: "sha256:<hex>"}`，每个文件必须有对应 hash
  - `entry`（可选）：该变体的引擎入口 artifact，相对路径。每个量化变体可有不同
    的入口文件（如 per-quant GGUF），因此 `entry` 在 variant 级可选。省略时变体
    入口默认收敛为：单文件变体取该唯一文件；多文件 bundle 取 `install.entry`。
  - `total_size_bytes`：预计总下载字节数（进度计算与磁盘预检）
  - `host_requirement`：该变体的精确 host fitness 输入
    - `accelerator`：值域固定为 `cpu` / `metal` / `cuda`
    - `min_ram_bytes`
    - `min_vram_bytes`：仅当 `accelerator != cpu` 时必填
- `fitness`（必填）：主模型 fitness 元数据
  - `param_count`
  - `context_length`
- `companions`（可选，0+）：被动伴随资产列表。仅出现在引擎确实需要它的 row 上
  （image / video workflow 模型）；core text/speech row 不携带 `companions`。
  每个 companion 是一个 **parent-bound passive asset**——它所嵌套的 row 即其
  parent。companion 的固定结构为：
  - `companion_kind`：被动资产种类，值域固定为 `K-LOCAL-007` passive-kind 枚举
    （`vae` / `clip` / `lora` / `controlnet` / `auxiliary`）。companion 是被动
    资产，不携带 `capabilities`、不携带 `fitness`。
  - `engine_slot`：引擎定义的 workflow 槽位标识（`K-LOCAL-031`，典型值如
    `vae_path` / `llm_path` / `clip_path`）。同一 parent row 内 `engine_slot`
    不得重复。
  - `install`（必填）：与主模型同构的可安装事实（`repo` / `revision` /
    `install_kind` / `entry` / `artifact_roles` / `preferred_engine`）。
  - `variants`（必填，1+）：与主模型同构的量化变体列表。每个 companion variant
    携带 `variant_id` / `quant` / `files` / `hashes` / `total_size_bytes` /
    `host_requirement`，其约束与主模型 variant 完全一致。

不变量：

- `capabilities` 必须是 `K-MCAT-024` canonical token；local legacy token
  （`chat` / `embedding` / `tts` / `stt`）不得作为 local-plane row capability。
- 解析后用于 `model.asset` dependency env key 与 `InstallVerifiedAsset` 的
  `asset_id` 是 variant 级标识（`variant_id`）；两个量化变体是两个不同的可安装
  资产，因此 `tables/local-environment-dependencies.yaml` 的 `model.asset`
  env key `[asset_id, model_family, runtime_data_root]` 无需新增字段。`variant_id`
  是 installable identity；当一个 model/companion 的变体身份跨 accelerator
  （例如同一 quant 的 `cuda` 与 `metal` 变体）时，accelerator-specific 变体行
  仍是各自独立的 `variant_id`——这是同一 schema 下增加的独立 variant 行，不是
  schema 结构变更。
- verified row 的 host fitness 必须以每个变体的 `host_requirement` 为精确输入；
  verified row 不得使用 filename/size 推断（该保守路径仅保留给 `K-LOCAL-021d`
  live HuggingFace search）。
- 每个 variant（主模型与 companion 同等）必须携带 `hashes`；缺失完整性材料必须
  fail-close。
- companion 是 parent-bound 的被动资产：它解析出的 `variant_id` 成为一条
  `model.companion-asset` dependency 的 `asset_id`，其 `parent_asset_id` 是
  parent row 已解析变体的 `asset_id`。即使物理上是共享文件，companion 仍按
  parent 各自建模为独立 dependency（`model.companion-asset` env key 以
  `parent_asset_id` 为键）。companion 因此 inline 建模在所属 model row 下，而不是
  作为独立共享 row。
- local-plane block 覆盖所有 first-run capability tier：`text.generate` /
  `audio.transcribe` / `audio.synthesize` / `image.generate` / `video.generate`。
  schema 不按 tier 分叉；缺失某一 tier 的 row 不影响 schema 完整性。
- `text.embed` row 可以存在于 local catalog，但 embedding 不是 first-run local
  baseline slot（见 `K-MCAT-033`）。

## K-MCAT-033 Curated Presets Section

`runtime_plane: local` provider source 必须携带一个 `presets` section，把 factory
AIProfile install level 绑定到具体 model slot。这是人工 curation 的"选哪些模型"
决策面——不可自动化、必须保持可更新。

`presets` 的固定结构为：

```
presets:
  minimal:
    factory_aiprofile_alias: local-speech-ready
    slots:
      - slot: <slot id>  capability: <canonical token>  model_ref: <model_id>  required: <bool>  host_conditional: <bool, optional>
  recommended:
    factory_aiprofile_alias: local-gpu
    slots:
      - ...
```

不变量：

- `presets` 的固定 install level key 为 `minimal` 与 `recommended`，与
  `ai-profile-factory-catalog.yaml` 的 `first_run_install_levels` 枚举对齐。
- 每个 preset 是 **单一固定** 的具体模型集合。`recommended` 只有一个 preset；
  跨机器伸缩由 variant 选择（`K-MCAT-035`）实现，不得通过增设 preset 实现。
- `slot.model_ref` 必须解析到同 provider 下一个已 admitted 的 catalog row，且该
  row 的 `capabilities` 必须包含 `slot.capability`。
- 每个 preset 声明的 capability 集合必须是其绑定 factory AIProfile（
  `factory_aiprofile_alias`）`capability_set` 的子集，并与之一致。
- `required: true` slot 进入 readiness gate；`host_conditional: true` slot 在
  无变体可适配的 host 上允许被省略（`K-MCAT-036` host-conditional 省略规则）。
  无变体可适配的 `required` slot 使该 preset 在该 host 上 fail-close；resolver
  不替换为另一个 preset。
- `text.embed` 不得作为任何 install level 的 preset slot。本地专用 embedding
  模型是常驻资源成本，cloud embedding 成本低或免费；embedding 是
  post-initialization / cloud-default 能力，不属于 first-run local baseline。
  `minimal` 与 `recommended` 都不得 curate 本地 embedding 模型。
- preset section 只存在于 Runtime model catalog source；不得出现在
  `ai-profile-factory-catalog.yaml`——factory AIProfile 保持 model-agnostic
  （`P-AIPS-002`）。preset 绑定是 Runtime catalog truth，满足 `P-AIPS-005`
  指名的"Runtime model catalog"。
- `K-MCAT-022` activation guardrail 同样约束 preset：runtime adapter 尚未接入的
  capability/variant 对应的 slot 不得被 preset 标记为可激活 required slot。

## K-MCAT-034 Deterministic Local Model Resolver

Runtime 必须提供一个确定性 resolver，将抽象的 factory AIProfile install level 与
host posture 解析为具体的 per-slot 可安装资产绑定。它关闭 first-run Phase 3
materialization 缺失 `asset_id` 的 blocking gap。

resolver contract 固定为：

```
resolve(install_level, host_posture) -> ResolvedModelSet | FailClose
```

- `install_level` ∈ `{minimal, recommended}`，来自用户 first-run 选择。
- `host_posture` 是 Runtime `CollectDeviceProfile`（`K-DEV-*`）产出的
  `LocalDeviceProfile`。resolver 只消费 Runtime host evidence，不得重新探测硬件。
- `ResolvedModelSet` 的每个 slot 投影为 `{slot, capability, asset_id,
  variant_id}`；`asset_id` 是 variant 级标识（`K-MCAT-032`）。

resolver 必须 **确定性**：相同 `(install_level, host_posture, catalog_version)`
必须产出相同输出。

resolver 是 profile-scoped 而非 first-run-private：`P-AIPS-012` 把 factory
AIProfile 同时 admitted 给 `first-run` / `first-party-app` / `scope-bound-apply`，
因此同一个 `resolve()` 服务这三类 caller；first-run seam 只是其中一个 caller。

resolver algorithm 固定为：

1. **Preset lookup**：从 catalog 解析 `presets[install_level]`。未知 install
   level 必须 fail-close，reason code `local_model_resolve_install_level_invalid`。
2. **Per-slot variant selection**：对每个 slot，按 `K-MCAT-035` 选择变体。
3. **Outcome**：按 `K-MCAT-036` 判定 `ResolvedModelSet` / `FailClose`。

curation 选模型、resolver 选 bits：模型身份是 `presets` 中的 curated 决策
（`K-MCAT-033`），resolver 的唯一自由度是 variant 选择——一个确定性阈值检查。
resolver 不在 preset 之间做替换：用户选定的 preset 在该 host 上要么完整解析，
要么 fail-close。

同一个确定性 resolver 同时服务两条 first-run 路径：`MintRuntimeBaselineReadiness`
的 readiness-evidence activation 路径（`K-LENV-ACT-011`），以及
`ResolveLocalEnvironmentPlan` 的 desktop 首启 materialization 路径
（`K-RPC-025`，install-level plan resolution）。两条路径都调用这同一个
`resolve()`，都不自行决策。因此对相同 `(install_level, host_posture,
catalog_version)`，两条 seam 必须解析出**完全相同**的 per-slot 资产——一致性由
resolver 的确定性（本节）保证，不是由两套并行逻辑各自维持。materialization 路径
按 `pack -> hosted capabilities` 关系把 `ResolvedModelSet` 的 slot 投影为 plan 的
`model.asset` / `model.companion-asset` 依赖；activation 路径按 engine-consumer
到 slot 的映射投影为 baseline consumer binding。投影方式不同，被投影的
`ResolvedModelSet` 必须相同。

## K-MCAT-035 Resolver Variant Selection

resolver 对每个 preset slot 的变体选择固定为：

1. 加载 catalog model row `slot.model_ref`。
2. 对每个 `variants[]` 变体计算其相对 `host_posture` 的 eligibility：
   - `host_requirement.accelerator` 必须在 host 上可用。
   - 估算 footprint 相对 host budget，复用 `K-LOCAL-021c` 的固定 tier 阈值：
     `recommended`（`estimated_mem <= 70% budget`）、`runnable`（`<= 85%`）、
     `tight`（`<= 100%`）、`not_recommended`（`> budget`）。
3. 在达到至少 `runnable` tier 的变体中，选择 **最高 quant rank**。quant rank 是
   catalog-defined 的固定全序（`F16 > Q8_0 > Q6_K > Q5_K_M > Q4_K_M > Q4_0 >
   Q3 > Q2`），并带稳定 catalog-defined tie-break。
4. `tight` 或 `not_recommended` 变体不得被自动选择。
5. 若没有变体达到 `runnable`：
   - `host_conditional: true` slot → 标记 slot **omitted**，附 typed note。
   - `required: true` slot → 标记 slot **unsatisfiable**。

`llmfit` / `media-fit`（`K-LOCAL-021c` / `K-LOCAL-021d`）在此被复用为 **variant
selector**，不是 model selector；不得新增第二套 fitness 机制。LLM 主模型复用
`K-LOCAL-021d` 的 `fit_level -> tier` 映射，media 主模型复用 `K-LOCAL-021c` 的
头寸阈值。当 metadata 或设备画像不完整时，resolver 必须降低 confidence 并附
reason/note，不得静默按高置信度结果选择变体。

当 slot 的 model row 携带 `companions`（`K-MCAT-032`）时，resolver 对 **每个
companion** 也运行同一套 variant 选择算法（步骤 1-5），输入同一 `host_posture`。
companion 的变体选择与主模型变体选择完全同构——没有第二套 companion-specific
选择机制。slot 的解析结果因此从 `{slot, capability, asset_id, variant_id}` 扩展为
携带 `companions: [{companion_kind, engine_slot, asset_id, variant_id}]`，每个
companion binding 的 `asset_id` 是该 companion 选中变体的 `variant_id`。

## K-MCAT-036 Host-Conditional Slot Omission

resolver outcome 固定为：

- 所有 `required` slot 满足 → 返回 `ResolvedModelSet`。被省略的
  `host_conditional` slot 不进入 `ResolvedModelSet`，每个附 typed reason
  `local_model_resolve_slot_omitted`。
- 某个 `required` slot unsatisfiable（无论 `install_level` 是 `minimal` 还是
  `recommended`）→ 返回 `FailClose`，reason code
  `local_model_resolve_host_unsupported`。

resolver 不在 preset 之间做替换。用户选定的 install level 在该 host 上要么完整
解析，要么 fail-close——fail-close 是"该 host tier 当前未被 catalog 覆盖"的诚实
信号，不是对用户所选 preset 的静默替换。`host_conditional` optional slot 的
host-conditional 省略与此不同：它仍交付每一个 `required` slot，因此是 preset
内的适配而非替换，实现产品手册的 "image slot 可在弱机省略" 行为，且不引入
device-class-keyed presets。当用户选定的 preset 在该 host 上 fail-close 时，
用户可改选另一个 install level；catalog 对更多 host tier 的覆盖由后续 curation
扩展。

一个 slot 的 **主模型或其任意 companion**（`K-MCAT-032`）无法在该 host 上选出
至少 `runnable` 变体时，该 slot 视为 unsatisfiable，并沿用上述同一规则——
`required` slot → `FailClose`（`local_model_resolve_host_unsupported`）；
`host_conditional` slot → 省略（`local_model_resolve_slot_omitted`）。companion
的不可满足不引入新的 resolver outcome 类型，也不引入新的 reason code；它折叠进
既有 `K-MCAT-035` 变体选择与 `K-MCAT-037` fail-close 纪律。

## K-MCAT-037 Resolver Fail-Close Discipline

resolver 必须严格 fail-close：

- 任何 slot 都不得被 `tight` / `not_recommended` 变体静默满足。
- 任何 `required` slot unsatisfiable——无论 `install_level` 是 `minimal` 还是
  `recommended`——都必须 fail-close，reason code
  `local_model_resolve_host_unsupported`；resolver 不得替换为另一个 preset。
- `FailClose` outcome 必须携带 typed reason code；first-run state machine 将其
  投影为 `blocked` / `repair_required` / `unsupported`，不得产出 placeholder
  `asset_id`，不得 pseudo-success。
- resolver reason code 是 Runtime-owned activation projection；消费者不得发明。
  resolver reason code 与现有 dependency-family activation reason code
  （`model_asset_missing` 等）属于同一 activation gate 投影面，固定为：
  - `local_model_resolve_install_level_invalid`
  - `local_model_resolve_slot_omitted`
  - `local_model_resolve_host_unsupported`
  这些 reason code 注册在 `tables/activation-gate-reason-codes.yaml`。
- resolver 解析出的 `asset_id` 是 variant 级标识；它被填入 first-run baseline
  consumer binding，使下游 `model.asset` dependency env key
  `[asset_id, model_family, runtime_data_root]` 取到非空值，从而 `model.asset`
  缺失 `asset_id` 的 fail-close 不再在 baseline path 上误触发。
- resolver 不得跨 preset 静默换模型，也不得在 `ResolvedModelSet` 之外伪造
  ready 状态。

## Local Resolver Verification Anchors

- `K-MCAT-032` / `K-MCAT-033`：`pnpm check:runtime-catalog-drift`
- `K-MCAT-034` / `K-MCAT-035` / `K-MCAT-036` / `K-MCAT-037`：`runtime` Go
  resolver 单元测试 + `go run ./cmd/runtime-compliance --gate`（resolver
  implementation and compliance evidence must exist before production
  readiness is claimed）
