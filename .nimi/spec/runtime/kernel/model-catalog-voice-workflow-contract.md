# Runtime Model Catalog Voice And Workflow Contract

> Owner Domain: `K-MCAT-*`

Voice, speech, workflow, binding matrix, video, and capability vocabulary authority for Runtime model catalog.

This file is a semantic split from `model-catalog-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-MCAT-007 DashScope Voice Path

For DashScope TTS models, `ListPresetVoices` and TTS voice validation MUST be catalog-driven. OpenAI-compatible voice discovery endpoint probing MUST NOT be the primary resolution path.

## K-MCAT-010 DashScope First Rollout

Phase-1 mandatory coverage:

- `qwen3-tts-instruct-flash`
- `qwen3-tts-instruct-flash-2026-01-26`
- `qwen3-tts-flash` family entries

DashScope published voices for these models MUST be represented in `runtime/catalog/providers/dashscope.yaml`.

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
2. model-level `voice.request_options` / `transcription` / `embedding`
   / `image_request_options`

约束如下：

- `selection_profiles` 必须 source-authored、reviewed、并声明 `reviewed_at + freshness_sla_days`
- `selection_profiles` 只能引用同 provider 下已存在、且 capability 匹配的 model
- `voice.request_options` 只能出现在 `audio.synthesize` model 上
- `transcription` 只能出现在 `audio.transcribe` model 上
- `embedding` 只能出现在 `text.embed` model 上；`embedding.dimension` 是该 model 输出维度的 catalog 权威，供 runtime memory embedding profile 解析消费（`K-MEM-004`、`K-AIEXEC-006`）。它必须 source-authored，且只承载 model-inherent 的维度事实；distance_metric / migration_policy 属于 runtime memory-bank policy，不是 model catalog 事实，不在此声明。
- `image_request_options` 只能出现在 `image.generate` model 上，且必须表达 runtime canonical `ImageGenerateScenarioSpec` 的请求支持面：`response_formats`、`max_images_per_request`、`supports_negative_prompt`、`supports_reference_images`、`supports_mask`、`supports_seed`、`supports_size`、`supports_aspect_ratio`、`supports_quality`、`supports_style`。这些字段是 route describe producer 的唯一 image request metadata 来源；adapter raw payload、provider name、model label、Desktop 参数 UI 不得反向补造。
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
