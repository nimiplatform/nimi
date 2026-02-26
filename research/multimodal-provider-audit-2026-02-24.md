# 多厂商多模态接口与 Nimi Proto/DAG 兼容性审计

- 审计时间：2026-02-24（本地执行）
- 审计范围：
  - 厂商：Anthropic / OpenAI / Gemini(Google) / Alibaba / ByteDance(Volcengine) / MiniMax / Kimi(Moonshot) / GLM(智谱)
  - 模态：TTS / STT / Image / Video
  - Nimi 侧：`docs/refactory` 新 proto 草案与当前 `nimi`（独立开源仓）runtime/sdk 实现
- 证据策略：优先官方文档；官方未公开或页面动态不可完整抓取时，显式标注“证据等级”与不确定性

## 1. 厂商接口定义（最新公开口径）

> 说明：下文“接口定义”按“公开 API 入口 + 关键请求字段 + 返回/异步语义”整理。  
> 证据等级：A=官方 API 文档字段级明确；B=官方文档有能力说明但字段不完整；C=仅官方公告/入口可见、字段不完整。

### 1.1 Anthropic（证据等级：A/B，结论偏“能力边界”）

#### TTS
- 公开 API 未提供独立 TTS 生成端点（未见 `/audio/speech` 类接口）

#### STT
- 公开 API 未提供独立 STT 转写端点（未见 `/audio/transcriptions` 类接口）

#### Image
- Claude 支持“图像输入理解（vision input）”，但未见独立“图像生成”API

#### Video
- 公开 API 未见独立视频生成端点

#### 主要接口面（用于对照）
- `POST /v1/messages`（文本/多模态输入理解）

#### 参考
- [Anthropic API Overview](https://docs.anthropic.com/en/api/overview)
- [Anthropic API Reference](https://docs.anthropic.com/en/api/messages)
- [Claude Vision（图像输入）](https://docs.anthropic.com/en/docs/build-with-claude/vision)

### 1.2 OpenAI（证据等级：A）

#### TTS
- Endpoint：`POST /v1/audio/speech`
- 关键请求字段：`model`, `input`, `voice`, `response_format`, `speed`
- 返回：音频二进制（同步）

#### STT
- Endpoint：`POST /v1/audio/transcriptions`
- 关键请求字段：`file`, `model`, `language`, `prompt`, `response_format`, `temperature`, `timestamp_granularities`
- 返回：转写文本/结构化结果（同步）

#### Image
- Endpoint：`POST /v1/images/generations`
- 关键请求字段：`prompt`, `model`, `size`, `quality`, `style`, `background`, `response_format`, `n`
- 返回：`url` 或 base64（同步）

#### Video
- Endpoint：`POST /v1/videos`
- 关键请求字段：`model`, `prompt`, `image`(可选), `size`, `seconds`
- 返回：视频任务对象（异步）；再用 `GET /v1/videos/{video_id}` 查询状态，结果含下载 URL

#### 参考
- [OpenAI Audio Speech](https://platform.openai.com/docs/api-reference/audio/createSpeech)
- [OpenAI Audio Transcriptions](https://platform.openai.com/docs/api-reference/audio/createTranscription)
- [OpenAI Images](https://platform.openai.com/docs/api-reference/images/create)
- [OpenAI Videos API](https://platform.openai.com/docs/api-reference/videos/create)
- [OpenAI Cookbook: Generate videos with Veo](https://cookbook.openai.com/examples/generate_videos_with_veo)

### 1.3 Gemini / Google（证据等级：A）

#### TTS
- Endpoint（Gemini API）：`POST /v1beta/models/{model}:generateContent`
- 关键请求字段：`contents`, `generationConfig.responseModalities=["AUDIO"]`, `speechConfig`
- 返回：音频块（通常在 candidates parts 中）

#### STT
- 路径：通过 `generateContent` 传音频（`inlineData` 或文件上传后引用），以 prompt 指令转写
- 关键请求字段：音频输入 + 转写指令；可要求时间戳或结构化输出
- 备注：Gemini 文档中是“音频理解/转写能力”，不是独立 STT endpoint 形态

#### Image
- Endpoint：`POST /v1beta/models/gemini-2.5-flash-image:generateContent`（或同类 image 模型）
- 关键请求字段：`contents`, `generationConfig.responseModalities=["TEXT","IMAGE"]`
- 返回：文本+图像 parts

#### Video
- Endpoint（Veo）：`POST /v1beta/models/{videoModel}:predictLongRunning`
- 关键请求字段：prompt、分辨率/比例等视频参数（随模型版本）
- 返回：长任务 `operations/*`；轮询 operation 获取结果

#### 参考
- [Gemini Speech Generation](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Gemini Audio（音频理解/转写）](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini Image Generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini Video Generation](https://ai.google.dev/gemini-api/docs/video)
- [Vertex Video Generation（predictLongRunning）](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/video-generation)

### 1.4 Alibaba Model Studio（证据等级：A）

#### TTS
- Endpoint：`POST /api/v1/services/aigc/multimodal-generation/generation`
- 关键请求字段（Qwen-TTS）：`model`, `input.text`, `parameters.voice`, `parameters.format`, `sample_rate`
- 返回：支持 stream / sync / async 三种模式

#### STT
- Endpoint：`POST /api/v1/services/audio/asr/transcription`
- 关键请求字段：`model`, 音频输入（URL或文件）、语言/转写参数
- 返回：同步或异步任务；异步通过 `task_id` + `/api/v1/tasks/{task_id}` 查询

#### Image
- Endpoint：`POST /api/v1/services/aigc/image2image/image-synthesis`
- 关键请求字段：`model`, `input.prompt`，可选参考图/风格参数
- 返回：图片 URL / 任务结果

#### Video
- Endpoint：`POST /api/v1/services/aigc/video-generation/video-synthesis`
- 关键请求字段：`model`, `input.prompt`, `parameters.resolution/aspect_ratio/duration`（模型相关）
- 返回：异步任务，按 `task_id` 查询

#### 参考
- [Alibaba Qwen-TTS](https://www.alibabacloud.com/help/en/model-studio/developer-reference/instant-text-to-speech)
- [Alibaba Qwen-ASR](https://www.alibabacloud.com/help/en/model-studio/developer-reference/audio-transcription)
- [Alibaba Wanx Image](https://www.alibabacloud.com/help/en/model-studio/developer-reference/image-generation)
- [Alibaba Wan2.2 Video](https://www.alibabacloud.com/help/en/model-studio/developer-reference/video-generation)

### 1.5 ByteDance / Volcengine（证据等级：A）

#### 体系说明（关键）
- 方舟平台（ARK，OpenAI 兼容）：图像、视频、LLM/Embeddings
- 豆包语音（OpenSpeech）：TTS / ASR（独立鉴权与协议，含 WebSocket）

#### TTS（豆包语音）
- 同步 HTTP：`POST https://openspeech.bytedance.com/api/v1/tts`
- 流式 WS：`wss://openspeech.bytedance.com/api/v1/tts/ws_binary`
- 异步：`POST /api/v1/tts_async/submit` + `GET /api/v1/tts_async/query`

#### STT（豆包语音）
- 快速识别 HTTP：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
- 流式 ASR WS：`wss://openspeech.bytedance.com/api/v2/asr`

#### Image（方舟）
- Endpoint：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
- 关键字段：`model`, `prompt`, `response_format`，以及模型特定参数

#### Video（方舟）
- 创建：`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 查询：`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}`
- 任务型异步接口，支持列表/取消

#### 参考
- [Volcengine 图片生成 API](https://www.volcengine.com/docs/82379/1541523)
- [Volcengine 创建视频任务](https://www.volcengine.com/docs/82379/1520757)
- [Volcengine 查询视频任务](https://www.volcengine.com/docs/82379/1521309)
- [Volcengine 语音 API 总览](https://www.volcengine.com/docs/6561/1096680)
- [Volcengine TTS WebSocket](https://www.volcengine.com/docs/6561/79821)
- [Volcengine 流式 ASR WebSocket](https://www.volcengine.com/docs/6561/80818)
- [Volcengine Flash ASR](https://www.volcengine.com/docs/6561/1707234)

### 1.6 MiniMax（证据等级：A/B）

#### TTS
- Endpoint：`POST https://api.minimax.io/v1/t2a_v2`
- 关键请求字段：`model`, `text`, `stream`, `voice_setting`, `audio_setting`
- 返回：可流式/非流式音频

#### STT
- 在公开 API 参考中未发现稳定独立 STT 文档入口（需按当前账号文档权限再次确认）

#### Image
- 创建任务：`POST https://api.minimax.io/v1/image_generation`
- 查询任务：`GET https://api.minimax.io/v1/query/image_generation?task_id=...`
- 关键字段：`model`, `prompt`, `aspect_ratio`, `response_format`, `subject_reference`

#### Video
- 创建任务：`POST https://api.minimax.io/v1/video_generation`
- 查询任务：`GET https://api.minimax.io/v1/query/video_generation?task_id=...`
- 关键字段：`model`, `prompt`, `first_frame_image`, `last_frame_image`, `duration`

#### 参考
- [MiniMax Text-to-Speech](https://platform.minimax.io/docs/api-reference/text-to-speech)
- [MiniMax Create Image Task](https://platform.minimax.io/docs/api-reference/create-image-generation-task)
- [MiniMax Query Image Task](https://platform.minimax.io/docs/api-reference/query-image-generation-status)
- [MiniMax Video Generation](https://platform.minimax.io/docs/api-reference/video-generation)
- [MiniMax Query Video Task](https://platform.minimax.io/docs/api-reference/query-video-generation-status)

### 1.7 Kimi / Moonshot（证据等级：A）

#### TTS
- Endpoint：`POST /v1/audio/speech`
- 关键字段：`model`, `input`, `voice`, `format`

#### STT
- Endpoint：`POST /v1/audio/transcriptions`
- 关键字段：`file`, `model`, `response_format`（及模型特定选项）

#### Image
- 路径：`POST /v1/chat/completions` 走多模态输出
- 关键字段：`response.modalities=["image"]`, `response.output_image_format`，以及消息内容
- 同时支持图像理解（image input）

#### Video
- 公开文档未见稳定视频生成 API 入口（当前口径可视为未公开）

#### 参考
- [Moonshot API 文档入口](https://platform.moonshot.cn/docs/api)
- [Moonshot Chat（含图像理解/图像生成）](https://platform.moonshot.cn/docs/api/chat)
- [Moonshot 语音识别](https://platform.moonshot.cn/docs/api/audio/input)
- [Moonshot 语音生成](https://platform.moonshot.cn/docs/api/audio/output)

### 1.8 GLM / 智谱（证据等级：A）

#### TTS
- Endpoint：`POST https://open.bigmodel.cn/api/paas/v4/audio/speech`
- 关键字段：`model`, `input`, `voice`, `speed`, `stream`

#### STT
- Endpoint：`POST https://open.bigmodel.cn/api/paas/v4/audio/transcriptions`
- 关键字段：`file`, `model`, `response_format` 等

#### Image
- Endpoint：`POST https://open.bigmodel.cn/api/paas/v4/images/generations`
- 关键字段：`model`, `prompt`, `size`, `user_id`

#### Video
- 创建：`POST https://open.bigmodel.cn/api/paas/v4/videos/generations`
- 查询：`GET https://open.bigmodel.cn/api/paas/v4/async-result/{task_id}`
- 明确异步任务语义

#### 参考
- [GLM TTS](https://docs.bigmodel.cn/cn/api/paas/audio_api/speech)
- [GLM STT](https://docs.bigmodel.cn/cn/api/paas/audio_api/transcriptions)
- [GLM Image](https://docs.bigmodel.cn/cn/api/paas/v4/images)
- [GLM Video](https://docs.bigmodel.cn/cn/api/paas/v4/videos)
- [GLM Async Query](https://docs.bigmodel.cn/cn/api/paas/v4/async-query)

## 2. Nimi Refactory Proto + Runtime 兼容性审计

### 2.1 审计对象（本地源码）

- Proto 草案：
  - `docs/refactory/runtime-proto.md`
  - `nimi/proto/runtime/v1/ai.proto`
  - `nimi/proto/runtime/v1/workflow.proto`
- SDK：
  - `nimi/sdk/packages/ai-provider/src/index.ts`
- Runtime：
  - `nimi/runtime/internal/services/ai/artifact_methods.go`
  - `nimi/runtime/internal/services/ai/provider_openai_media.go`
  - `nimi/runtime/internal/services/workflow/executor.go`

### 2.2 结论总览

- 结论：**当前并不能兼容上述全部厂商的全模态接口形态**。
- 当前设计属于“最小公共子集”：
  - Image/Video：只支持 `prompt`；
  - TTS：只支持 `text`；
  - STT：只支持 `audio_bytes + mime_type`；
  - Workflow：是通用 DAG 壳，缺“外部异步任务”一等公民语义。

### 2.3 字段级不兼容点（关键证据）

#### 问题 P0-1：媒体请求字段过窄，无法表达主流厂商关键参数
- 证据：
  - `GenerateImageRequest` 仅 `prompt` + 路由字段  
  - `GenerateVideoRequest` 仅 `prompt` + 路由字段  
  - `SynthesizeSpeechRequest` 仅 `text` + 路由字段  
  - `TranscribeAudioRequest` 仅 `audio_bytes/mime_type` + 路由字段
- 影响：
  - 无法对接 `voice/format/sample_rate/speed`（TTS）
  - 无法对接 `timestamps/diarization/language/prompt`（STT）
  - 无法对接 `size/aspect_ratio/style/seed/negative_prompt/n`（Image）
  - 无法对接 `duration/fps/resolution/ref_frame/camera_motion`（Video）

#### 问题 P0-2：异步任务模型缺失，Video/Image 厂商无法完整兼容
- 证据：
  - `RuntimeAiService.GenerateVideo` 定义为“直接流 ArtifactChunk”，无 `job_id/status`
  - 多家厂商视频为 task 模式（OpenAI/Google/Alibaba/Volcengine/MiniMax/GLM）
- 影响：
  - 只能做“同步阻塞式桥接”，无法完整映射任务生命周期、失败原因和重试语义

#### 问题 P1-1：Artifact 元数据不足且 mime 固定
- 证据：
  - Runtime 中 image/video/speech 分别强制 `"image/png"`, `"video/mp4"`, `"audio/mpeg"`
  - `ArtifactChunk` 无 codec/duration/fps/resolution/sample_rate/channels/source_url/checksum
- 影响：
  - 厂商原始返回无法无损透传
  - 后续工作流节点（转码、拼接、审核）缺必要元数据

#### 问题 P1-2：Workflow 缺“外部任务驱动 DAG”语义
- 证据：
  - `WorkflowNode` 只有 `node_type/config/retry`，无 `provider_job_id/resume_token/callback`
  - executor 当前是模拟进度 sleep，不是 provider async orchestration
- 影响：
  - 无法把“提交任务→轮询→完成回调→下游节点”建成可靠 DAG

#### 问题 P1-3：SDK facade 再次收窄，阻止能力透传
- 证据：
  - SDK video/tts/stt 类型只暴露 `prompt|text|audioBytes+mimeType`
  - SDK 调用时仅透传上述字段
- 影响：
  - 即便 runtime 扩展字段，SDK 也会成为瓶颈

#### 问题 P2-1：Model 能力元信息不可机器判定
- 证据：
  - `model.proto` 只有 `repeated string capabilities`
- 影响：
  - 无法做字段级可用性协商，难以在路由前做 fail-close 校验

## 3. 厂商兼容性矩阵（当前 Nimi 状态）

| 厂商 | TTS | STT | Image | Video | DAG 异步任务兼容 |
|---|---|---|---|---|---|
| Anthropic | N/A（官方未公开） | N/A（官方未公开） | 输入理解可借 text API | N/A | 无意义（厂商侧能力边界） |
| OpenAI | 部分兼容（缺 voice/format 等） | 部分兼容（缺 timestamps 等） | 部分兼容（缺 size/style 等） | 不兼容完整任务模型 | 不兼容 |
| Gemini | 部分兼容（通过 generateContent） | 部分兼容（音频理解式转写） | 部分兼容 | 不兼容完整任务模型 | 不兼容 |
| Alibaba | 部分兼容 | 部分兼容 | 部分兼容 | 不兼容完整任务模型 | 不兼容 |
| ByteDance | 不兼容（缺独立语音协议） | 不兼容（WS ASR） | 部分兼容（ARK） | 不兼容完整任务模型 | 不兼容 |
| MiniMax | 部分兼容 | 待确认（公开文档未见稳定 STT） | 不兼容完整任务模型 | 不兼容完整任务模型 | 不兼容 |
| Kimi | 部分兼容 | 部分兼容 | 部分兼容（经 chat multimodal） | 官方未见公开 API | 不兼容 |
| GLM | 部分兼容 | 部分兼容 | 部分兼容 | 不兼容完整任务模型 | 不兼容 |

## 4. 解决方案（可落地）

### 4.1 设计目标

- 目标不是“最小交集”，而是“可表达所有主流厂商能力 + 可严格校验 + 可降级路由”。
- 设计原则：
  - Canonical 强类型字段覆盖 80% 共性
  - `provider_options` 兜底覆盖厂商特性
  - 异步任务是一等对象，不再把所有媒体强塞成同步流

### 4.2 Proto 改造建议（V1 增量，不破坏旧接口）

#### A. 新增统一媒体请求对象
- `MediaRequestCommon`
  - `app_id`, `subject_user_id`, `model_id`, `route_policy`, `fallback`, `timeout_ms`
  - `request_id`, `idempotency_key`, `labels`
- `ImageGenerationSpec`
  - `prompt`, `negative_prompt`, `n`, `size`, `aspect_ratio`, `quality`, `style`, `seed`
  - `reference_images[]`, `mask`, `response_format`
- `VideoGenerationSpec`
  - `prompt`, `negative_prompt`, `duration_sec`, `fps`, `resolution`, `aspect_ratio`, `seed`
  - `first_frame`, `last_frame`, `camera_motion`
- `SpeechSynthesisSpec`
  - `text`, `voice`, `language`, `audio_format`, `sample_rate_hz`, `speed`, `pitch`, `volume`, `emotion`
- `SpeechTranscriptionSpec`
  - `audio_source(oneof bytes/url/chunks)`, `language`, `timestamps`, `diarization`, `speaker_count`, `prompt`, `response_format`
- 每个 spec 附 `google.protobuf.Struct provider_options`

#### B. 新增异步任务 API（核心）
- `SubmitMediaJob` -> `MediaJob {job_id, provider_job_id, status, eta, created_at}`
- `GetMediaJob`（含进度、失败原因、重试信息）
- `CancelMediaJob`
- `SubscribeMediaJobEvents`
- `GetMediaArtifacts`（返回 artifact 列表及 metadata）

#### C. 扩展 Artifact
- 新增 `ArtifactMeta`
  - `uri`, `mime_type`, `size_bytes`, `sha256`, `duration_ms`, `fps`, `width`, `height`, `sample_rate_hz`, `channels`, `provider_raw`

#### D. Workflow 增强（外部任务节点）
- `WorkflowNode` 增字段：
  - `execution_mode` (`INLINE` | `EXTERNAL_ASYNC`)
  - `resume_strategy`, `idempotency_key`, `callback_ref`
- `WorkflowEvent` 增事件：
  - `NODE_EXTERNAL_SUBMITTED`, `NODE_EXTERNAL_RUNNING`, `NODE_EXTERNAL_COMPLETED`, `NODE_EXTERNAL_FAILED`
- `WorkflowNodeStatus` 增：
  - `provider_job_id`, `next_poll_at`, `last_error`, `retry_count`

### 4.3 Runtime 架构改造建议

- 建立 `ProviderMediaAdapter` 分层：
  - `toProviderRequest(canonical, provider_options)`
  - `fromProviderResponse(raw) -> canonical status/artifacts`
- 对异步厂商统一接入 `Job Orchestrator`：
  - 提交任务
  - 状态轮询（指数退避 + SLA 超时）
  - 结果拉取与 artifact 落库
  - 事件发布给 workflow
- WebSocket 厂商（ByteDance TTS/ASR）走专用 transport adapter，不再硬塞通用 HTTP postJSON 流程

### 4.4 SDK 改造建议

- 扩展 `ai-provider` 输入类型：
  - `video.generate({ prompt, durationSec, resolution, aspectRatio, ... , providerOptions })`
  - `tts.synthesize({ text, voice, audioFormat, sampleRateHz, speed, ... })`
  - `stt.transcribe({ audioBytes|audioUrl|audioStream, language, timestamps, diarization, ... })`
- 保留旧签名（deprecated），内部映射到新结构，避免破坏现有调用方

### 4.5 能力协商与 fail-close

- `RuntimeModelService` 返回结构化 capability profile（而非字符串列表）
- 请求前执行：
  - 字段支持性校验
  - 单位/范围校验（如 `duration_sec`、`sample_rate_hz`）
  - 不支持时返回明确 `AI_ROUTE_UNSUPPORTED` + `action_hint`

## 5. 迁移路线（建议）

### 阶段 1（协议扩展，不破坏现有）
- 新增 proto message + 新 RPC，不删除旧 RPC
- runtime 先支持 OpenAI/GLM/Alibaba 的 async job 路径

### 阶段 2（Provider 适配）
- 接入 ByteDance 双体系（ARK + OpenSpeech）
- 接入 MiniMax 任务型 image/video
- 接入 Kimi 音频 + 图像（chat multimodal）

### 阶段 3（Workflow 真正编排）
- workflow executor 从“模拟进度”切换到“外部任务驱动”
- 节点恢复、重试、取消、幂等全链路

### 阶段 4（SDK 收口）
- 默认新接口，旧接口维持兼容窗口
- 回归矩阵覆盖 8 厂商 × 4 模态

## 6. Nimi 本地证据清单（关键文件）

- Proto（媒体字段极简）：
  - `nimi/proto/runtime/v1/ai.proto`
- Workflow（缺外部任务字段）：
  - `nimi/proto/runtime/v1/workflow.proto`
- Refactory 草案与现状一致：
  - `docs/refactory/runtime-proto.md`
- SDK 输入收窄：
  - `nimi/sdk/packages/ai-provider/src/index.ts`
- Runtime 媒体 mime 固定：
  - `nimi/runtime/internal/services/ai/artifact_methods.go`
- Runtime 仅 OpenAI-like 媒体调用实现：
  - `nimi/runtime/internal/services/ai/provider_openai_media.go`
- Workflow executor 当前为模拟推进：
  - `nimi/runtime/internal/services/workflow/executor.go`

## 7. 最终结论

- 结论 1：当前 `refactory + proto + sdk + runtime` 不能“无损兼容” Anthropic/OpenAI/Gemini/Alibaba/Bytedance/Minimax/Kimi/GLM 在 TTS/STT/Video/Image 的最新主流接口定义。
- 结论 2：最大阻塞点是“异步任务模型缺失 + 字段表达能力不足 + Workflow 无外部任务语义”。
- 结论 3：按本报告提出的“canonical + provider_options + async job first-class + workflow external node”方案改造后，可实现跨厂商统一编排，并保持 fail-close 与可审计性。
