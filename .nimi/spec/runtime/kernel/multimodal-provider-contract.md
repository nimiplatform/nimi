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

`media` 补充：

- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised backend matrix 的唯一事实源。runtime 必须通过统一 resolver 消费 v2 matrix entries，不得在 localservice、ai execution、daemon 各自推断 image supervised 路径。
- v2 matrix 按 `entry_id` 索引，以 `platform + asset_family + backend_family + profile_kind` 标识 topology 槽位。`topology_state` 与 `product_state` 分离；只有 `product_state=supported` 的 entry 才允许进入 install recommendation、activation、ready health success。
- runtime 到 `media` engine 的私有协议必须直接承接 runtime canonical image/video spec，不得回落到 OpenAI-compatible `/v1/images/generations`、`/v1/video/generations` 或 legacy catalog-only 健康路径。
- `media` engine 私有协议固定为：`GET /healthz`、`GET /v1/catalog`、`POST /v1/media/image/generate`、`POST /v1/media/video/generate`。
- `proxy_execution` 与 `pipeline_supervised` 共享同一 canonical HTTP surface；request body 与 artifact response envelope 在两种 mode 下保持同形，但 `proxy_execution` 不得再通过 llama route 承载稳定 image product path。
- 对 v2 matrix resolver 选中的 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` image 路径，dynamic profile import 如需额外 materialization 步骤，只允许作为 runtime 私有内部实现存在；app-facing consume 仍必须固定落到 `POST /v1/media/image/generate`。
- 对 v2 matrix resolver 选中的 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` + `asset_family=safetensors_native_image` image 路径，适用与 `gguf_image` 相同的 native binary execution 规则；但 `product_state` 独立于 `gguf_image`，未经 host tuple 验证前保持 `unsupported`。
- 对 v2 matrix resolver 选中的 `backend_class=python_pipeline` + `backend_family=diffusers` image 路径，必须确认该 entry 的 `product_state` 已达到 `supported` 且 `admission_gate` 已通过，方可进入 install / activation / execution。
- 对 canonical local image product path，runtime 不得将 host 不支持误投影成 `ATTACHED_ENDPOINT + AI_LOCAL_ENDPOINT_REQUIRED`；必须保持 `SUPERVISED` 契约并以 `AI_LOCAL_MODEL_UNAVAILABLE + compatibility detail` fail-close。
- `media` 只允许暴露真实 ready 的 image/video 模型目录；依赖未安装、设备不可用、模型未解析、管线未初始化时必须 fail-close，不得伪造成功 artifact 或静态 model list。
- `media.diffusers` 只允许作为 `media` 的内部 fallback driver 出现在 runtime metadata / execution strategy；不得作为 public config、public adapter 选择面或手工 engine target。当前 kernel 基线仍规定 `media.diffusers` 不得在未完成规范修订前直接升格为 matrix-supported canonical path。
- `backend_family`、`backend_class`、`product_state` 等 v2 matrix 字段只允许落在 runtime-private resolved detail、provider hints `extra`、audit detail；本轮不新增 typed proto 字段（K-LENG-015）。

`speech` 补充：

- runtime 到 `speech` engine 的私有协议必须直接承接 runtime canonical speech 与 voice workflow spec，不得伪装成 OpenAI-compatible TTS/STT workflow 成功语义。
- `speech` engine 私有协议固定为：`GET /healthz`、`GET /v1/catalog`、`POST /v1/audio/transcriptions`、`POST /v1/audio/speech`、`POST /v1/voice/clone`、`POST /v1/voice/design`。
- `speech` 只允许暴露真实 ready 的 STT/TTS/voice workflow 模型目录；缺失 `qwen3tts` 等 workflow bundle 时必须 fail-close。
- `speech` supervised host 必须显式区分 placeholder state 与 admitted plain-speech state：
  - placeholder state 下，`GET /healthz` 只回答 host 可达与 placeholder state；不得伪装 execution-plane ready。
  - admitted plain-speech state 下，`GET /healthz` 只有在 local plain-speech minimum admitted proof 成立后，才允许返回 `ready=true`。
- `GET /v1/catalog` 在 placeholder state 下只允许暴露 placeholder / non-ready rows；在 admitted state 下，只有当 target row 满足 admitted plain-speech proof 且 row capability 与 admitted capability truth 一致时，才允许暴露 ready rows。
- 在 admitted local plain-speech execution plane 尚未 materialize 前，`POST /v1/audio/transcriptions` 与 `POST /v1/audio/speech` 必须继续 fail-close 为 plain-speech execution-plane unavailable，而不是 generic speech success 或 silent downgrade。
- `speech` 的 public diagnostics / detail 不得暴露 raw request payload、runtime-private bootstrap path、或 raw probe URL；若需要更细原因字段，只允许进入 runtime-private detail / audit surface。
- 在 local workflow execution plane 尚未 admitted 前，`/v1/voice/clone` 与 `/v1/voice/design` 必须明确返回 capability-not-admitted / fail-close 语义，而不是 generic speech success 或静默降级。
- plain-speech admitted driver family（例如当前 `kokoro` / `whispercpp`）不得被隐式提升为 workflow-family admission truth；后续 workflow-capable local family（例如 `voxcpm` / `omnivoice`）若要 admitted，必须拥有独立的 workflow model / binding / handle policy truth。
- workflow-capable TTS family 的成功结果不得替代 `audio.transcribe` 验收；speech 全链路成功必须继续保留独立 STT family truth。
- 当 local workflow execution 进入 first-family admitted wave 时：
  - `/v1/voice/clone` 与 `/v1/voice/design` 只允许对 admitted family 返回成功
  - 当前首轮 admitted family 边界固定为 `voxcpm`
  - unsupported local workflow family（包括 `omnivoice`）必须继续返回 family-scoped fail-close，而不是 generic local speech success
  - `GET /healthz` 与 `GET /v1/catalog` 仍不得把某一 admitted workflow family 的成功投影为 generic local workflow-ready

## K-MMPROV-011 Workflow External Async

workflow 外部异步节点事件语义必须与多模态任务生命周期对齐。

## K-MMPROV-012 Validation & Fail-Close

字段不支持、策略不通过、provider 不可用时必须 fail-close。

## K-MMPROV-013 DashScope Voice Catalog Primary Path

DashScope TTS 的 voice 解析主路径必须由 catalog 驱动（权威定义见 `K-MCAT-007`）。兼容模式 voice endpoint 探测不得作为主路径。

## K-MMPROV-014 Cross-Layer Traceable Voice Diagnostics

TTS voice 解析与校验日志必须可观测 `catalog_source`、`model_resolved` 与 `voice_count`，用于 Runtime → SDK → Desktop/Mod 统一排障。

## K-MMPROV-015 DashScope Voice Legacy Bypass Forbidden

针对 DashScope，禁止以 legacy/hardcode voice 兜底绕过 catalog 校验。

## K-MMPROV-016 Local Media Canonical Image Workflow Mapping

Runtime 在不引入 DAG 编排的前提下，必须支持 canonical local image workflow（t2i/i2i）：

- t2i：当 `reference_images` 为空时，不下发 `file/files/ref_images`。
- i2i：`reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images`。
- `negative_prompt` 存在时，必须透传 `negative_prompt`。
- 本地路由（`local/*`）必须基于已解析 engine（`llama` / `media` / `sidecar`）推断 providerType，避免 adapter 误判。
- `nimi.scenario.image.request` 命名空间允许 runtime 接收 `profile_overrides`：
  - image workflow 的 slot 依赖（`vae_path`、`llm_path`、`lora_path`、`controlnet_path` 等）由 runtime 从当前 profile 的已安装 passive asset entries 按 `engineSlot` 解析注入（`K-LOCAL-031`），不再由调用方通过 `components[]` 显式提供。
  - 当 profile 中缺失 workflow 必需的 `engineSlot` 绑定时，runtime 必须 fail-close（`AI_INPUT_INVALID`），不得猜测 companion 或使用默认值。
  - `profile_overrides` 允许覆盖非路径 profile 字段（`K-LOCAL-032`）；`parameters.model`、`download_files` 与任何 `*_path` 原始值必须由 runtime 注入或拒绝。
  - `profile_overrides` 单独存在但 profile 未绑定对应 slot asset 时，不得触发 dynamic import。
  - runtime 渲染完成后，必须从 forwarded extensions 中移除 `profile_overrides`。
- image `response_format` 只允许 `b64_json`、`base64`（归一化为 `b64_json`）或 `url`；其他值必须 fail-close（`AI_MEDIA_OPTION_UNSUPPORTED`）。
- 当 provider 返回 URL artifact 时，runtime 下载必须继承父请求 `ctx`，并施加有界读取上限；超时、取消、空载荷或超限载荷必须 fail-close（`AI_OUTPUT_INVALID`）。

| 场景 | 输入条件 | Runtime 动作 | 结果 |
|---|---|---|---|
| t2i | `reference_images` 为空 | 不下发 `file/files/ref_images` | 仅按文本生成 |
| i2i | `reference_images` 非空 | `reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images` | 形成最简 image-to-image 映射 |
| negative prompt 透传 | `negative_prompt` 存在 | 始终透传 `negative_prompt` | 不得静默丢弃 |
| workflow slot 缺失 | profile 缺失 workflow 必需的 `engineSlot` 绑定 | fail-close | `AI_INPUT_INVALID` |
| slot asset 不可用 | profile slot asset 未安装或 `UNHEALTHY` | fail-close | `AI_INPUT_INVALID` |
| profile overrides 越界 | `profile_overrides` 触碰 `parameters.model`、`download_files` 或任何 `*_path`，或 profile 未绑定 slot asset 却触发 dynamic import | 由 runtime 注入或拒绝 | fail-close 或忽略 dynamic import |
| response_format 合法 | `response_format` 为 `b64_json`、`base64`、`url` | `base64 -> b64_json` 归一化，其余透传 | 保持兼容 |
| response_format 非法 | `response_format` 为其他值 | fail-close | `AI_MEDIA_OPTION_UNSUPPORTED` |
| URL artifact 下载失败 | provider 返回 URL artifact，且下载出现超时、取消、空载荷或超限载荷 | 下载继承父请求 `ctx` 且使用有界读取 | `AI_OUTPUT_INVALID` |

## K-MMPROV-017 Legacy Image Option Reject Strategy

本地 image 路径不得继续为 legacy `LocalAI/Nexa` 选项名保留 public contract 兼容。对没有 canonical 同名语义的遗留键：

- `extensions.step` 优先；`extensions.steps` 在 `step` 缺失时映射到 `step`。
- `extensions.mode` 优先；`extensions.method` 在 `mode` 缺失时映射到 `mode`。
- 对当前路径无稳定同名请求字段的键（`guidance_scale` / `eta` / `strength` / `clip_skip`）不得 fail-close，必须以 ignored 形式可观测回传。
- image artifact `ScenarioArtifact.metadata` 必须至少包含：
  - `adapter`
  - `prompt`
  - `source_image`
  - `ref_images_count`
  - `local.applied_options`
  - `local.ignored_options`

| 输入键 | 优先级/映射 | Runtime 动作 | 可观测结果 |
|---|---|---|---|
| `extensions.step` | 第一优先级 | 直接写入 `step` | 记入 `local.applied_options` |
| `extensions.steps` | 仅当 `step` 缺失 | 映射到 `step` | 记入 `local.applied_options` |
| `extensions.mode` | 第一优先级 | 直接写入 `mode` | 记入 `local.applied_options` |
| `extensions.method` | 仅当 `mode` 缺失 | 映射到 `mode` | 记入 `local.applied_options` |
| `guidance_scale` | 无稳定同名请求字段 | 不 fail-close | 记入 `local.ignored_options` |
| `eta` / `strength` / `clip_skip` | 无稳定同名请求字段 | 不 fail-close | 记入 `local.ignored_options` |
| artifact metadata | 成功返回 image artifact | 写入 `ScenarioArtifact.metadata`，至少填充 `adapter`、`prompt`、`source_image`、`ref_images_count`、`local.applied_options`、`local.ignored_options` | 供排障与兼容性回放 |

## K-MMPROV-018 TTS VoiceReference Primary Contract

TTS v2 合成请求主入口必须是强类型 `voice_ref`，不允许回退到自由字符串 voice 字段。

## K-MMPROV-019 Voice Workflow Canonical Inputs

Voice 工作流 canonical 输入字段（`tts_v2v` / `tts_t2v`）由 `multimodal-canonical-fields.yaml` 管理，provider 不得以隐式参数替代必填字段约束。

对 `tts_v2v`，canonical 输入允许可选 `v2v.text`。当 provider 明确要求提供参考音频的 transcript / text 描述时，必须显式透传并在缺失时 fail-close；禁止 runtime 伪造 transcript。

provider extension 若暴露 `base_url` 覆写入口，仅允许与当前 provider 基线 endpoint 保持同一 scheme、host 与 canonical base path。不得借由 same-origin 不同 path 的覆写把请求转发到管理端点、私有运维路径或其它非 voice workflow API 面。

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
- `i2v_reference`：必须包含至少 1 条 `IMAGE_URL+REFERENCE_IMAGE`，可附文本 prompt。

`prompt` 在 `t2v` 模式下为必需字段；在 `i2v_*` 模式下是否必需由 provider/model 能力与输入角色合同决定，但若出现文本内容，则必须以 `TEXT+PROMPT` 角色表达。

所有模式均可附加可选的 `VIDEO_URL+REFERENCE_VIDEO` 与 `AUDIO_URL+REFERENCE_AUDIO`，用于视频风格参考和背景音频输入。provider/model 是否支持这些可选角色及其最大数量由 catalog `input_roles + limits` 声明决定；runtime 不得把 source/snapshot 中声明的“允许角色集合”误解释为“每次请求必须显式提供的完整角色集合”。

当请求包含 `AUDIO_URL+REFERENCE_AUDIO` 时，必须同时存在至少一个视觉参考输入（`FIRST_FRAME` / `LAST_FRAME` / `REFERENCE_IMAGE` / `REFERENCE_VIDEO` 之一）；不得接受“仅文本 + 音频参考”的无视觉锚点请求。

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

## K-MMPROV-030 Text Chat Multimodal Preflight Guard

`TEXT_GENERATE` 场景接受多模态 `ChatContentPart`（`parts` 字段）时，runtime 必须在调用 provider 前执行逐项模态预检：

- `IMAGE_URL` -> 必须校验 `text.generate.vision`
- `AUDIO_URL` -> 必须校验 `text.generate.audio`
- `VIDEO_URL` -> 必须校验 `text.generate.video`
- `ARTIFACT_REF` -> 必须先解析为可消费的 image/audio/video 输入，再按解析后的模态执行能力预检
- 目标模型未声明对应 capability 时，必须 fail-close 返回 `AI_MODALITY_NOT_SUPPORTED`（K-NIMI-009）
- catalog 中未找到模型条目时，允许放行；但 provider adapter 若缺少该模态映射，仍必须在执行前 fail-close，不得静默降级
- 未知或未实现的 text-chat part type 必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`

`TEXT_GENERATE` v2 的输入/输出边界：

- 输出始终是 text；媒体输出不得通过 `TEXT_GENERATE` 返回
- 输入允许 `text`、`image_url`、`audio_url`、`video_url`、`artifact_ref`
- 大媒体输入仅允许 `URL` 或 `artifact_ref`；inline binary / data URI 不得作为 text chat runtime contract
- media-only prompt 合法；但 system-only 或空内容请求必须 fail-close 为 `AI_INPUT_INVALID`

## K-MMPROV-031 Realtime Session Contract Boundary

双向低延迟 text/audio 会话不得塞入 `AIService` 既有 scenario RPC；必须通过独立 `RuntimeAiRealtimeService` 暴露。

- `OpenRealtimeSession` 负责会话建立与 route/model 决策
- `AppendRealtimeInput` 负责增量输入（text/audio）
- `ReadRealtimeEvents` 负责 text delta / audio chunk / terminal event 的 server stream
- `CloseRealtimeSession` 负责显式结束会话
- v1 provider-backed realtime 只要求 llama text+audio：
  - 输入允许 `ChatMessage(TEXT parts only)` 与 `RealtimeAudioInput`
  - 输出允许 `RealtimeTextDelta`、`RealtimeAudioChunk`、`RealtimeCompleted`、`RealtimeFailed`
  - 单 session 只允许一个活跃 reader；冲突 reader 必须 fail-close
- 其他 provider 若尚未实现 realtime，runtime 必须显式返回 unsupported / unimplemented，不得伪造成普通 `TEXT_GENERATE` 流式响应

## K-MMPROV-032 AI Artifact Upload Ingress

大媒体 upload-first ingress 必须通过 `RuntimeAiService.UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用。

- RPC 形态固定为 client-stream：
  - 首帧必须携带 `UploadArtifactMetadata`
  - 后续帧必须携带按序 `UploadArtifactChunk`
- v1 允许的媒体范围仅为 `image/*`、`audio/*`、`video/*`
- 上传完成前不得被 scenario 或 realtime 消费
- `UploadArtifact` 返回的 `artifact_id` 只能在同 app / subject 作用域内消费
- v1 不要求 resumable / multipart lifecycle；单次 upload 完成即得 `artifact_ref.artifact_id`
- 非法首帧、mime 或 chunk 序号必须返回 `AI_ARTIFACT_UPLOAD_INVALID`
- 超限上传必须返回 `AI_ARTIFACT_UPLOAD_TOO_LARGE`

## K-MMPROV-033 Remote OpenAI Text Multimodal Baseline

远端 OpenAI text-chat multimodal provider-specific mapper 的 v1 基线固定为 `image + audio`。

- `IMAGE_URL` 继续走 provider-native `image_url`
- `AUDIO_URL` 与可解析的 `artifact_ref(audio)` 必须映射为 provider-native audio input part
- `VIDEO_URL` 与 `artifact_ref(video)` 在远端 OpenAI 路径本轮必须 fail-close 为 `AI_MEDIA_OPTION_UNSUPPORTED`
- generic OpenAI-compatible mapper 不得假装支持 audio/video；只有明确 provider-native `openai` mapper 才能放开 `text.generate.audio`

## K-MMPROV-034 `nimi.scenario.music_generate.request` v1

`MUSIC_GENERATE` 可通过 `ScenarioExtension.namespace = "nimi.scenario.music_generate.request"` 承载 v1 iteration 扩展。该扩展仅定义以下字段：

- `mode`: `extend | remix | reference`
- `source_audio_base64`: iteration 模式必填
- `source_mime_type`: 可选
- `trim_start_sec`: 可选
- `trim_end_sec`: 可选

除上述字段外，runtime 不得把未知 key 继续下传 provider。

当请求携带该扩展时，runtime 必须额外校验模型在 catalog 中声明了 `music.generate.iteration` capability；未声明则必须 fail-close。

## K-MMPROV-035 Music Iteration Fail-Close

- 无扩展时，`MUSIC_GENERATE` 视为 prompt-only 路径。
- 扩展存在但 `mode` 非法、缺 `source_audio_base64`、base64 无法解码、trim 为负值、或 `trim_end_sec <= trim_start_sec` 时，runtime 必须返回 `AI_MEDIA_SPEC_INVALID`。
- provider 不支持该 iteration 语义时，runtime 必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。
- capability 已声明但 runtime 内部没有对应 provider strategy 时，仍必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。

## K-MMPROV-036 Capability-Gated Iteration Baseline

iteration 支持必须由 `music.generate.iteration` capability 与 runtime provider strategy 共同决定，不能只靠 provider 名字硬编码。

- `stability` 是当前官方闭源基线 provider，必须显式声明 `music.generate.iteration` capability，并消费 runtime 规范化后的 typed iteration 输入。
- `suno` 可保留为实验性路径；若继续声明 `music.generate.iteration`，也必须消费 runtime 规范化后的 typed iteration 输入，不得原样盲传未验证字段。
- `soundverse`、`mubert`、`loudly` 当前规范基线只要求 `music.generate` prompt-only；若未声明 `music.generate.iteration` capability，则带 iteration 扩展时必须 fail-close。
- `local` provider 当前规范基线只要求 prompt-only；`sidecar` 本地 backend 后续可在声明 capability 后增量开放 iteration。
- 本规则不新增新的顶层 RPC；iteration 继续复用通用 `ScenarioJob` / artifact 契约。

## K-MMPROV-037 Stable AI Output Typed Contract

稳定 AI product surface 不得再以 `google.protobuf.Struct` 作为主输出契约承载。runtime 必须使用显式 typed proto message：

- sync `TEXT_GENERATE` -> `ExecuteScenarioResponse.output.text_generate.text`
- sync `TEXT_EMBED` -> `ExecuteScenarioResponse.output.text_embed.vectors[]`
- async `SPEECH_TRANSCRIBE` -> `GetScenarioArtifactsResponse.output.speech_transcribe.text`
- async `SPEECH_SYNTHESIZE` -> `GetScenarioArtifactsResponse.output.speech_synthesize.artifacts[]`
- async `IMAGE_GENERATE` -> `GetScenarioArtifactsResponse.output.image_generate.artifacts[]`
- async `VIDEO_GENERATE` -> `GetScenarioArtifactsResponse.output.video_generate.artifacts[]`
- async `MUSIC_GENERATE` -> `GetScenarioArtifactsResponse.output.music_generate.artifacts[]`
- stream text delta -> `ScenarioStreamDelta.text.text`
- stream reasoning delta -> `ScenarioStreamDelta.reasoning.text`
- stream artifact delta -> `ScenarioStreamDelta.artifact.{chunk,mime_type}`

约束：

- `ScenarioOutput` 必须作为稳定 product output 的唯一 oneof 容器；sync 路径挂在 `ExecuteScenarioResponse.output`，async artifact/job 路径挂在 `GetScenarioArtifactsResponse.output`。不得要求 SDK/app 通过 `Struct.fields.*`、artifact bytes、或 MIME 约定猜测字段语义。
- `TEXT_GENERATE` 请求中的 reasoning 配置必须使用 typed `TextGenerateScenarioSpec.reasoning`，至少覆盖 `mode`、`trace_mode`、`budget_tokens`；legacy/缺省请求保持 `OFF + HIDE` 语义，不得因模型默认值漂移破坏旧客户端。
- `ScenarioStreamDelta` 必须使用显式 oneof 分支表达 text/reasoning/artifact；不得再混用自由字段或让消费方根据场景类型推断 delta 语义。
- provider 若不支持请求的 reasoning 开关、独立 trace 或 budget，必须 fail-close；不得把 reasoning 静默并入正文、伪造空 trace，或在 stable surface 上假装成功。
- text stream timeout 语义必须拆分为首包超时、空闲超时和绝对上限；reasoning/text/tool/usage 增量都应视为 activity 并刷新 idle timer，但单纯 started 事件不构成有效进展。
- `google.protobuf.Struct` 仅允许保留在 workflow/internal explicit-dynamic envelope 等非稳定 product surface，不得继续作为 text/embed/stt/image/video/music 等高频 app-facing 能力的事实源。
- SDK/desktop/relay 的高层 helper 必须直接消费这些 typed output/delta，不得把稳定 protobuf message 重新降格为 `Record<string, unknown>` 再解析。
## K-MMPROV-038 Native-Binary Managed Backend Contract

- For `backend_class=native_binary`, runtime may materialize profiles privately, but execution must terminate at the managed image backend gRPC contract and may not call llama `/models/import`.
- `POST /v1/media/image/generate` is still the only canonical app-facing execution surface; callers must never observe a second image control-plane API.
- If `proxy_execution` cannot connect the request to the managed image backend direct contract, it must fail-close instead of forwarding through llama or any legacy management route.
- Supported native-binary tuples may be backed by a runtime-owned package entrypoint or a runtime-owned wrapper around the published backend binary, but both variants must preserve the same managed image backend gRPC contract and fail-close semantics.
- Package-source selection inside the managed native-binary path is runtime-private. Choosing a canonical or experimental package source must not change the public request path, response envelope, or any app-visible provider/model contract.
- Unsupported managed-image package tuples must fail-close before provider execution begins, using `AI_LOCAL_MODEL_UNAVAILABLE` rather than a generic provider internal error.
