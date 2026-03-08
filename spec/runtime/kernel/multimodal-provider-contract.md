# Runtime Multimodal Provider Contract

> Owner Domain: `K-MMPROV-*`

## K-MMPROV-001 Canonical Common Head

多模态 canonical 请求头字段集合由 `multimodal-canonical-fields.yaml` 管理。

`TEXT_GENERATE` 与 `TEXT_EMBED` 的主字段契约为 proto-first：以 `ScenarioSpec.text_generate` / `ScenarioSpec.text_embed` 为权威，不经 `multimodal-canonical-fields.yaml` 派生。

## K-MMPROV-002 Image Spec Contract

图像生成字段（prompt、size、quality、seed 等）必须在请求前可校验。

## K-MMPROV-003 Video Spec Contract

视频生成必须使用结构化规范 `mode + content[] + options`，并在请求前可校验。  
Legacy 字段（`first_frame_uri` / `last_frame_uri` / `camera_motion`）不得作为视频主契约输入字段。

## K-MMPROV-004 TTS Spec Contract

语音合成字段（voice/language/format/rate）必须在请求前可校验。

## K-MMPROV-005 STT Spec Contract

语音转写字段（audio_source/language/timestamps）必须在请求前可校验。

## K-MMPROV-006 Async Job First-Class

异步任务（特别是视频/长音频）必须作为一等能力，遵循 `K-JOB-*`。

## K-MMPROV-007 Artifact Meta Contract

artifact 元数据字段集合由 `multimodal-artifact-fields.yaml` 管理，必须支持 URL 与 inline 双模式。

## K-MMPROV-008 Adapter Obligations

每个 provider adapter 必须实现请求映射、响应归一化、reason code 归一化。

## K-MMPROV-009 Cloud Route Constraints

cloud 模态路由必须显式可观测，不得伪造成功响应。

## K-MMPROV-010 Local Provider Constraints

local provider 的能力暴露必须与本地 engine/capability 合同一致。

## K-MMPROV-011 Workflow External Async

workflow 外部异步节点事件语义必须与多模态任务生命周期对齐。

## K-MMPROV-012 Validation & Fail-Close

字段不支持、策略不通过、provider 不可用时必须 fail-close。

## K-MMPROV-013 DashScope Voice Catalog Primary Path

DashScope TTS 的 voice 解析主路径必须由 `K-MCAT-*` catalog 驱动。兼容模式 voice endpoint 探测不得作为主路径。

## K-MMPROV-014 Cross-Layer Traceable Voice Diagnostics

TTS voice 解析与校验日志必须可观测 `catalog_source`、`model_resolved` 与 `voice_count`，用于 Runtime → SDK → Desktop/Mod 统一排障。

## K-MMPROV-015 DashScope Voice Legacy Bypass Forbidden

针对 DashScope，禁止以 legacy/hardcode voice 兜底绕过 catalog 校验。

## K-MMPROV-016 LocalAI Minimal Image Workflow Mapping

Runtime 在不引入 DAG 编排的前提下，必须支持 LocalAI 图像最简工作流（t2i/i2i）：

- t2i：当 `reference_images` 为空时，不下发 `file/files/ref_images`。
- i2i：`reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images`。
- `negative_prompt` 存在时，必须透传 `negative_prompt`；若 `prompt` 未包含 `|`，则下发 `prompt=positive|negative`。
- 本地路由（`local/*`）必须基于已选 backend（如 `local-localai` / `local-nexa`）推断 providerType，避免 adapter 误判。
- `nimi.scenario.image.request` 命名空间允许 runtime 接收 `components[]` 与 `profile_overrides`：
  - `components[]` 只接受 `{slot, localArtifactId}`，不得接受原始文件路径。
  - `profile_overrides` 允许覆盖非路径 profile 字段；`parameters.model`、`download_files` 与任何 `*_path` 原始值必须由 runtime 注入或拒绝。
  - runtime 渲染完成后，必须从 forwarded extensions 中移除 `components` 与 `profile_overrides`。

## K-MMPROV-017 Nexa-Compatible Image Option Strategy

LocalAI image 路径必须提供 Nexa 常用参数的最佳努力兼容：

- `extensions.step` 优先；`extensions.steps` 在 `step` 缺失时映射到 `step`。
- `extensions.mode` 优先；`extensions.method` 在 `mode` 缺失时映射到 `mode`。
- 对当前路径无稳定同名请求字段的键（`guidance_scale` / `eta` / `strength`）不得 fail-close，必须以 ignored 形式可观测回传。
- image artifact `artifact_metadata` 必须至少包含：
  - `adapter`
  - `localai_prompt`
  - `source_image`
  - `ref_images_count`
  - `localai.applied_options`
  - `localai.ignored_options`

## K-MMPROV-018 TTS VoiceReference Primary Contract

TTS v2 合成请求主入口必须是强类型 `voice_ref`，不允许回退到自由字符串 voice 字段。

## K-MMPROV-019 Voice Workflow Canonical Inputs

Voice 工作流 canonical 输入字段（`tts_v2v` / `tts_t2v`）由 `multimodal-canonical-fields.yaml` 管理，provider 不得以隐式参数替代必填字段约束。

## K-MMPROV-020 Voice Workflow Fail-Close

Voice 工作流输入不完整、workflow 不支持、目标模型不匹配、资产状态非法时必须 fail-close，不得自动降级到 provider 默认 voice。

## K-MMPROV-021 TTS Timing & Render Hint Canonical Fields

TTS v2 在保持 provider 可扩展参数的同时，必须将跨 provider 高价值字段强类型化：

- `timing_mode`（`none|word|char`）
- `voice_render_hints.stability`
- `voice_render_hints.similarity_boost`
- `voice_render_hints.style`
- `voice_render_hints.use_speaker_boost`
- `voice_render_hints.speed`

以上字段事实源由 `multimodal-canonical-fields.yaml` 管理；产物对齐字段由 `multimodal-artifact-fields.yaml` 管理。

## K-MMPROV-022 Timing/Alignment Fail-Close Mapping

当调用方请求 `timing_mode=word|char` 时：

- provider 若支持，必须返回结构化 `speech_alignment`；
- provider 若不支持，必须 fail-close（`AI_MEDIA_OPTION_UNSUPPORTED` 或 provider 明确错误映射），禁止静默忽略或降级为 `none`。

## K-MMPROV-023 ElevenLabs Status Mapping Baseline

针对 ElevenLabs（及同类 TTS provider）适配器，HTTP 状态码最小映射基线为：

- `401|403` -> `AI_PROVIDER_AUTH_FAILED`
- `429` -> `AI_PROVIDER_RATE_LIMITED`
- `400|422` -> `AI_VOICE_INPUT_INVALID`（创建音色）或 `AI_MEDIA_OPTION_UNSUPPORTED`（合成参数）
- 目标模型/音色不兼容 -> `AI_VOICE_TARGET_MODEL_MISMATCH`
- 资产不可见或越权 -> `AI_VOICE_ASSET_SCOPE_FORBIDDEN`
- `5xx` -> `AI_PROVIDER_INTERNAL`
- 超时 -> `AI_PROVIDER_TIMEOUT`

## K-MMPROV-024 Video Mode/Role Matrix

Video mode 与 content role 组合必须严格匹配：

- `t2v`：至少 1 条 `TEXT+PROMPT`，禁止 `FIRST_FRAME/LAST_FRAME/REFERENCE_IMAGE`。
- `i2v_first_frame`：必须且仅 1 条 `IMAGE_URL+FIRST_FRAME`，可附文本 prompt。
- `i2v_first_last`：必须包含 `IMAGE_URL+FIRST_FRAME` 与 `IMAGE_URL+LAST_FRAME` 各 1 条，可附文本 prompt。
- `i2v_reference`：必须包含 1-4 条 `IMAGE_URL+REFERENCE_IMAGE`，可附文本 prompt。

任一 mode/role 冲突必须 fail-close（`AI_MEDIA_SPEC_INVALID` 或 `AI_MEDIA_OPTION_UNSUPPORTED`）。

## K-MMPROV-025 Video Option Guardrails

Video options 最小强校验基线：

- `frames` 与 `duration_sec` 互斥，冲突必须 fail-close。
- `seed` 范围固定 `[-1, 4294967295]`。
- `i2v_reference` 禁止 `camera_fixed=true`。
- `ratio` / `resolution` 必须经过 provider/model 能力矩阵校验。

## K-MMPROV-026 Volcengine Seedance Task Endpoints

Volcengine Seedance（第一批视频 provider）固定任务接口：

- submit: `POST /api/v3/contents/generations/tasks`
- query: `GET /api/v3/contents/generations/tasks/{task_id}`

adapter 请求体必须使用 `content[] + role` 语义，不得回退到 legacy 视频字段拼装。

## K-MMPROV-027 Async Task Status Normalization

provider 异步任务状态必须归一化到：

- `queued`
- `running`
- `cancelled`
- `succeeded`
- `failed`
- `expired`

运行时语义要求：

- `cancelled` -> Job `CANCELED`
- `expired` -> Job `TIMEOUT`
- `failed` -> Job `FAILED`

## K-MMPROV-028 TTS Layered Inclusion Baseline

TTS provider 纳入执行以下分层规则：

- `tts_synthesize` 为基础必备能力；
- `tts_v2v` 与 `tts_t2v` 为可选增量能力；
- 对仅 synthesize provider，不得要求其提供 voice workflow 强行对齐。

## K-MMPROV-029 Deferred Custom Voice Extension

云厂训练型 Custom Voice（训练作业、审批流程或长期部署语义）在本轮必须保持 provider extension 形态。  
在形成跨 provider 可验证强类型抽象前，不得强行映射为标准 `tts_v2v` / `tts_t2v` 成功语义。
