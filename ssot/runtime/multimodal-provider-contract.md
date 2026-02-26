---
title: Nimi Runtime Multimodal Provider Contract
status: ACTIVE
created_at: 2026-02-26
updated_at: 2026-02-26
parent: proto-contract.md
references:
  - ssot/runtime/service-contract.md
  - ssot/runtime/proto-contract.md
  - ssot/runtime/workflow-dag.md
  - ssot/runtime/local-runtime.md
  - dev/research/multimodal-provider-audit-2026-02-24.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Multimodal compatibility MUST be fail-close, never silent downgrade.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---

# Runtime 多厂商多模态兼容合同（V1.5 冻结）

## 0. 文档定位

本文件定义 Runtime 在多厂商多模态（TTS/STT/Image/Video）上的统一合同，目标是让协议、SDK、Runtime、Workflow 与测试口径一致，避免“最小公共子集”长期固化为技术债。

- 当前状态：`ACTIVE`
- 用途：冻结“字段表达能力 + 异步任务语义 + provider 适配边界 + 验收标准”
- 非目标：不定义 Desktop UI 交互稿，不定义厂商商业策略

## 1. 适用范围

覆盖 provider：

1. LocalAI
2. Nexa
3. LiteLLM（OpenAI-compatible 统一入口）
4. Alibaba adapter
5. Bytedance adapter
6. 未来新增第三方 provider adapter

覆盖模态：

1. `text`（Generate/StreamGenerate/Embed）
2. `image`
3. `video`
4. `tts`
5. `stt`

## 2. 设计目标（冻结）

1. 不是“最小公共子集”，而是“可表达主流厂商 80%+ 共性 + 可扩展兜底”。
2. 异步任务（尤其视频/长音频）必须是一等公民。
3. 请求前必须可校验（字段支持、单位范围、策略门控）。
4. 不支持的能力必须显式拒绝（`AI_ROUTE_UNSUPPORTED`），不得静默降级。
5. SDK 和 Proto 不能成为 Runtime 扩展瓶颈。

## 3. 总体架构

统一分层：

1. `Canonical Spec Layer`
2. `Provider Adapter Layer`
3. `Job Orchestrator Layer`
4. `Artifact Store + Metadata Layer`
5. `Workflow External-Async Bridge`

每个 provider adapter 必须实现：

1. `toProviderRequest(canonical, provider_options)`
2. `fromProviderResponse(raw) -> canonical status/artifacts`
3. `capability negotiation`
4. `reasonCode normalization`

## 4. Canonical 请求合同（MUST）

### 4.1 公共头（MediaRequestCommon）

最小字段：

1. `app_id`
2. `subject_user_id`
3. `model_id`
4. `route_policy`
5. `fallback`
6. `timeout_ms`
7. `request_id`
8. `idempotency_key`
9. `labels`

### 4.2 ImageGenerationSpec

最小字段：

1. `prompt`
2. `negative_prompt`
3. `n`
4. `size`
5. `aspect_ratio`
6. `quality`
7. `style`
8. `seed`
9. `reference_images[]`
10. `mask`
11. `response_format`
12. `provider_options` (`google.protobuf.Struct`)

### 4.3 VideoGenerationSpec

最小字段：

1. `prompt`
2. `negative_prompt`
3. `duration_sec`
4. `fps`
5. `resolution`
6. `aspect_ratio`
7. `seed`
8. `first_frame`
9. `last_frame`
10. `camera_motion`
11. `provider_options` (`google.protobuf.Struct`)

### 4.4 SpeechSynthesisSpec

最小字段：

1. `text`
2. `voice`
3. `language`
4. `audio_format`
5. `sample_rate_hz`
6. `speed`
7. `pitch`
8. `volume`
9. `emotion`
10. `provider_options` (`google.protobuf.Struct`)

### 4.5 SpeechTranscriptionSpec

最小字段：

1. `audio_source`（oneof: `bytes | url | chunks`）
2. `language`
3. `timestamps`
4. `diarization`
5. `speaker_count`
6. `prompt`
7. `response_format`
8. `provider_options` (`google.protobuf.Struct`)

## 5. 异步任务合同（MUST）

### 5.1 任务 API

必须新增并作为媒体主路径：

1. `SubmitMediaJob`
2. `GetMediaJob`
3. `CancelMediaJob`
4. `SubscribeMediaJobEvents`
5. `GetMediaArtifacts`

### 5.2 任务状态机

`SUBMITTED -> QUEUED -> RUNNING -> COMPLETED | FAILED | CANCELED | TIMEOUT`

约束：

1. `idempotency_key` 必须生效。
2. `FAILED` 必须带结构化失败原因（provider code + normalized reasonCode）。
3. 超时必须区分“provider timeout”与“orchestrator timeout”。
4. 任务完成后 artifact 元数据必须可回查。

## 6. Artifact 合同（MUST）

`ArtifactChunk` 仅保留传输语义；业务元数据必须落在 `ArtifactMeta`：

1. `uri`
2. `mime_type`
3. `size_bytes`
4. `sha256`
5. `duration_ms`
6. `fps`
7. `width`
8. `height`
9. `sample_rate_hz`
10. `channels`
11. `provider_raw`

约束：

1. 不得硬编码 image/video/audio 固定 mime。
2. 必须支持 URL artifact 和 inline bytes 双模式。
3. 必须支持后续 workflow 节点按 metadata 判定能力。

## 7. Provider 适配规则（MUST）

### 7.1 OpenAI-compatible 路径

1. LocalAI
2. LiteLLM
3. Alibaba adapter（兼容层）
4. Bytedance ARK adapter（兼容层）

要求：

1. 路由显式可见（`routeDecision + backendName`）。
2. provider 不可用时不得伪造成功响应。
3. SSE 不支持时可降级到非流，但必须写审计并暴露降级事实。

### 7.2 非兼容/半兼容路径（custom adapter）

必须支持“非 OpenAI 形态”的 provider 专有协议：

1. Bytedance OpenSpeech（HTTP + WS）
2. Gemini generateContent / operation 任务语义
3. MiniMax image/video 任务语义
4. Kimi 图像多模态输出语义
5. 其他未来 provider 的 task/WS 协议

当前交付切面（R5）：

1. R5 已纳入：Bytedance OpenSpeech（HTTP）、Gemini operation、MiniMax task
2. R6 增量已纳入：Bytedance OpenSpeech STT WebSocket transport（audio chunk 流式提交）
3. 后续待补：Kimi/GLM 专项 adapter

要求：

1. `provider_options` 只作为扩展，不替代 canonical 必填字段。
2. 非兼容协议必须在 adapter 层封装，不污染统一 service 入口。
3. 不可表达能力必须 fail-close，返回 `AI_ROUTE_UNSUPPORTED` + `action_hint`。

## 8. Local Provider 合同（MUST）

### 8.1 LocalAI

要求：

1. 受管运行硬化（loopback/api key/禁 webui 等）。
2. 能力矩阵必须包含节点级 adapter 与 backend 证据。
3. `chat/embedding` 默认 `openai_compat_adapter`。
4. `stt/tts/image/video` 默认 `localai_native_adapter`。

### 8.2 Nexa

要求：

1. 受管 service（`nexa-openai-gateway`）必须有真实实现，不得仅文档声明。
2. `providerHints.nexa` 字段必须进入 resolver + routing + node catalog。
3. NPU 可用性必须满足 `host probe AND model probe AND policy gate`。
4. `video` 默认不暴露时必须明确 reasonCode，不得误报可用。

## 9. Workflow 外部任务语义（MUST）

`RuntimeWorkflowService` 必须支持 external async node 语义：

1. `execution_mode = INLINE | EXTERNAL_ASYNC`
2. `provider_job_id`
3. `resume_strategy`
4. `callback_ref`
5. `next_poll_at`
6. `retry_count`
7. `last_error`

事件最小集合：

1. `NODE_EXTERNAL_SUBMITTED`
2. `NODE_EXTERNAL_RUNNING`
3. `NODE_EXTERNAL_COMPLETED`
4. `NODE_EXTERNAL_FAILED`

## 10. 校验与 fail-close（MUST）

请求前必须执行：

1. 字段支持性校验（provider/model/capability）
2. 单位与范围校验（duration/fps/sample_rate 等）
3. 路由合法性校验（local-runtime/token-api）
4. policy gate 校验（尤其 Nexa NPU）

拒绝语义：

1. `AI_ROUTE_UNSUPPORTED`
2. `AI_INPUT_INVALID`
3. `AI_PROVIDER_UNAVAILABLE`
4. `AI_PROVIDER_TIMEOUT`
5. provider-local reasonCode（LocalAI/Nexa 归一后透出）

## 11. 测试矩阵要求（MUST）

最小矩阵维度：

1. `provider x modality`
2. `routePolicy(local-runtime|token-api)`
3. `sync vs async`
4. `streaming vs non-streaming`
5. `success + unsupported + timeout + unavailable`

最小覆盖要求：

1. `RuntimeAiService` 语句覆盖率 `>= 70%`
2. 媒体核心路径函数覆盖率 `>= 80%`（image/video/tts/stt/async job）
3. provider adapter 合同测试覆盖所有已声明 provider
4. 至少一组端到端 workflow external-async 测试通过

## 12. 完成定义（DoD）

同时满足以下条件才可宣称“多厂商多模态兼容完成”：

1. Proto 提供 canonical media + async job 合同。
2. SDK 暴露对应字段，不再只暴露 prompt/text/audioBytes。
3. Runtime 具备 LocalAI/Nexa/LiteLLM + custom adapter 的真实执行链路。
4. Workflow 支持 external async 编排闭环。
5. 测试矩阵与覆盖率达到本文件门槛。
6. 发布门禁文件（`ssot/runtime/multimodal-delivery-gates.md`）全部通过。
