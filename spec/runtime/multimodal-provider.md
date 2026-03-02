# Multimodal Provider Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: 多厂商多模态兼容合同——canonical 请求/异步任务/artifact/provider adapter/测试矩阵。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- MediaJob 生命周期：`kernel/media-job-lifecycle.md`（`K-JOB-*`）
- Provider 健康与命名：`kernel/provider-health-contract.md`（`K-PROV-*`）
- 本地 category/capability：`kernel/local-category-capability.md`（`K-LOCAL-*`）
- RPC 面：`kernel/rpc-surface.md`（`K-RPC-*`）
- 错误模型：`kernel/error-model.md`（`K-ERR-*`）
- 流式契约：`kernel/streaming-contract.md`（`K-STREAM-*`）
- Workflow：`kernel/workflow-contract.md`（`K-WF-*`）

## 1. 领域不变量

`MMPROV-*` 为多模态 Provider 领域增量规则（非 kernel 通用规则）。

- `MMPROV-001`: 不是"最小公共子集"，而是"可表达主流厂商 80%+ 共性 + 可扩展兜底"。
- `MMPROV-002`: 异步任务（尤其视频/长音频）必须是一等公民（对齐 `K-JOB-001` MediaJob 适用 RPC）。
- `MMPROV-003`: 不支持的能力必须显式拒绝（`AI_MODALITY_NOT_SUPPORTED`），不得静默降级（对齐 `K-ERR-001`）。
- `MMPROV-004`: SDK 和 Proto 不能成为 Runtime 扩展瓶颈。
- `MMPROV-005`: 请求前必须可校验（字段支持、单位范围、策略门控）。

## 2. 适用范围

覆盖 provider（对齐 `K-PROV-002` 探测目标与 `K-PROV-006` provider 类型映射）：

1. LocalAI（探测目标 `local`）
2. Nexa（探测目标 `local-nexa`）
3. nimiLLM（探测目标 `cloud-nimillm`）
4. 通过 nimiLLM 接入的核心云 provider（OpenAI-compatible / Alibaba / Bytedance / Gemini / MiniMax / Kimi / GLM）
5. 未来新增云 provider（必须先纳入 `K-PROV-002` 探测目标清单）

覆盖模态（对齐 `K-LOCAL-001` 固定 category 与 `K-LOCAL-002` capability 映射）：

1. `text`（Generate/StreamGenerate/Embed，映射 LLM category）
2. `image`（映射 IMAGE category）
3. `video`
4. `tts`（映射 TTS category）
5. `stt`（映射 STT category）

## 3. 总体架构

统一分层：

1. `Canonical Spec Layer`
2. `Provider Adapter Layer`
3. `Job Orchestrator Layer`（对齐 `K-JOB-*`）
4. `Artifact Store + Metadata Layer`
5. `Workflow External-Async Bridge`（对齐 `K-WF-005`）

每个 provider connector 必须实现：

- `MMPROV-010`: `toProviderRequest(canonical, provider_options)` — 将 canonical 请求转换为 provider 原生格式。
- `MMPROV-011`: `fromProviderResponse(raw) -> canonical status/artifacts` — 将 provider 原生响应归一化。
- `MMPROV-012`: `capability negotiation` — 按模型 capability 协商可用能力。
- `MMPROV-013`: `reasonCode normalization` — 将 provider 错误码归一化为 `K-ERR-002` 标准 reasonCode。

## 4. Canonical 请求合同

### 4.1 公共头（MediaRequestCommon）

- `MMPROV-020`: 最小字段集合：`app_id`、`subject_user_id`、`model_id`、`route_policy`、`fallback`、`timeout_ms`、`request_id`、`idempotency_key`、`labels`（对齐 `K-RPC-002`）。

### 4.2 ImageGenerationSpec

- `MMPROV-021`: 最小字段：`prompt`、`negative_prompt`、`n`、`size`、`aspect_ratio`、`quality`、`style`、`seed`、`reference_images[]`、`mask`、`response_format`、`provider_options`。

### 4.3 VideoGenerationSpec

- `MMPROV-022`: 最小字段：`prompt`、`negative_prompt`、`duration_sec`、`fps`、`resolution`、`aspect_ratio`、`seed`、`first_frame`、`last_frame`、`camera_motion`、`provider_options`。

### 4.4 SpeechSynthesisSpec

- `MMPROV-023`: 最小字段：`text`、`voice`、`language`、`audio_format`、`sample_rate_hz`、`speed`、`pitch`、`volume`、`emotion`、`provider_options`。

### 4.5 SpeechTranscriptionSpec

- `MMPROV-024`: 最小字段：`audio_source`（oneof: bytes|url|chunks）、`language`、`timestamps`、`diarization`、`speaker_count`、`prompt`、`response_format`、`provider_options`。

## 5. 异步任务合同

- `MMPROV-030`: 异步任务 API 对齐 `K-JOB-001`（SubmitMediaJob/GetMediaJob/CancelMediaJob/SubscribeMediaJobEvents/GetMediaResult）。
- `MMPROV-031`: 状态机对齐 `K-JOB-002` 终态集合（COMPLETED/FAILED/CANCELLED/EXPIRED）。
- `MMPROV-032`: `idempotency_key` 必须生效。
- `MMPROV-033`: `FAILED` 必须带结构化失败原因（provider code + normalized reasonCode）。
- `MMPROV-034`: 超时必须区分"provider timeout"与"orchestrator timeout"。
- `MMPROV-035`: 凭据快照对齐 `K-JOB-003`（provider_type/endpoint/credential），快照清理对齐 `K-JOB-004`。

## 6. Artifact 合同

- `MMPROV-040`: `ArtifactMeta` 最小字段：`uri`、`mime_type`、`size_bytes`、`sha256`、`duration_ms`、`fps`、`width`、`height`、`sample_rate_hz`、`channels`、`provider_raw`。
- `MMPROV-041`: 不得硬编码 image/video/audio 固定 mime。
- `MMPROV-042`: 必须支持 URL artifact 和 inline bytes 双模式。
- `MMPROV-043`: 必须支持后续 workflow 节点按 metadata 判定能力。

## 7. 云 Provider 接入规则

### 7.1 nimiLLM 统一入口

- `MMPROV-050`: `token-api` 云路由必须统一经由 nimiLLM，不得按 provider 暴露 runtime 内部多分支。
- `MMPROV-051`: 路由显式可见（`routeDecision + backendName`）。
- `MMPROV-052`: provider 不可用时不得伪造成功响应（对齐 `K-PROV-001` 健康状态机）。
- `MMPROV-053`: SSE 不支持时可降级到非流，但必须写审计并暴露降级事实。
- `MMPROV-054`: 不可表达能力必须 fail-close，返回 `AI_MODALITY_NOT_SUPPORTED` + `action_hint`。

### 7.2 核心 provider 覆盖集（V1 冻结）

对齐 `K-PROV-006` 探测目标与 provider 类型映射：

1. OpenAI-compatible（通过 nimiLLM）
2. Alibaba（`cloud-alibaba` / `dashscope`）
3. Bytedance（`cloud-bytedance` / `volcengine` + `cloud-bytedance-openspeech`）
4. Gemini（`cloud-gemini` / `gemini`）
5. MiniMax（`cloud-minimax` / `openai_compatible`）
6. Kimi（`cloud-kimi` / `openai_compatible`）
7. GLM（`cloud-glm` / `openai_compatible`）

- `MMPROV-055`: 核心 provider 覆盖集变更必须先更新本合同，再更新测试矩阵与交付门禁证据。

## 8. 本地 Provider 合同

### 8.1 LocalAI

- `MMPROV-060`: 受管运行硬化（loopback/api key/禁 webui 等）。
- `MMPROV-061`: 能力矩阵必须包含节点级 adapter 与 backend 证据。
- `MMPROV-062`: `chat/embedding` 默认 `openai_compat_adapter`，`stt/tts/image/video` 默认 `localai_native_adapter`。

### 8.2 Nexa

- `MMPROV-070`: 受管 service 必须有真实实现（对齐 `K-PROV-002` 探测目标 `local-nexa`）。
- `MMPROV-071`: NPU 可用性必须满足 `host probe AND model probe AND policy gate`。
- `MMPROV-072`: `video` 默认不暴露时必须明确 reasonCode，不得误报可用。

## 9. Workflow 外部任务语义

- `MMPROV-080`: `RuntimeWorkflowService` 必须支持 external async node 语义（对齐 `K-WF-005`）。
- `MMPROV-081`: `execution_mode = INLINE | EXTERNAL_ASYNC`。
- `MMPROV-082`: 事件最小集合：`NODE_EXTERNAL_SUBMITTED`、`NODE_EXTERNAL_RUNNING`、`NODE_EXTERNAL_COMPLETED`、`NODE_EXTERNAL_FAILED`。

## 10. 校验与 fail-close

- `MMPROV-090`: 请求前必须执行字段支持性校验、单位与范围校验、路由合法性校验、policy gate 校验。
- `MMPROV-091`: 拒绝语义固定为 `AI_MODALITY_NOT_SUPPORTED`、`AI_MEDIA_SPEC_INVALID`、`AI_PROVIDER_UNAVAILABLE`、`AI_PROVIDER_TIMEOUT`、provider-local reasonCode。

## 11. 测试矩阵要求

- `MMPROV-100`: 最小矩阵维度：`provider x modality`、`routePolicy(local-runtime|token-api)`、`sync vs async`、`streaming vs non-streaming`、`success + unsupported + timeout + unavailable`。
- `MMPROV-101`: `RuntimeAiService` 语句覆盖率 `>= 70%`。
- `MMPROV-102`: 媒体核心路径函数覆盖率 `>= 80%`。
- `MMPROV-103`: provider 合同测试覆盖所有已声明 provider。
- `MMPROV-104`: 至少一组端到端 workflow external-async 测试通过。

## 12. 本文件非目标

- 不定义 MediaJob 生命周期状态机（见 kernel `K-JOB-002`）
- 不定义凭据快照与清理规则（见 kernel `K-JOB-003`/`K-JOB-004`）
- 不定义 provider 健康状态机（见 kernel `K-PROV-001`）
- 不定义流式 done 事件契约（见 kernel `K-STREAM-003`/`K-STREAM-004`）
- 不定义 ReasonCode 全值域（见 kernel `K-ERR-*`）
- 不定义 Desktop UI 交互稿，不定义厂商商业策略

## 13. 变更规则

修改多模态 provider 领域时必须同时满足：

1. 若触及跨域规则，先改 `spec/runtime/kernel/*`
2. 再改本文件的领域增量规则
3. 禁止在本文件新增 kernel 规则副本
