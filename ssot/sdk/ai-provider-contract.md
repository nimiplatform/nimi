---
title: Nimi SDK AI Provider Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - `@nimiplatform/sdk/ai-provider` 只做 SDK <-> Runtime 协议映射，不做静默语义降级。
  - 多模态任务走 runtime media job 合同；失败必须结构化、可追踪、可取消。
  - routePolicy/fallback 必须显式进入 runtime 请求，不允许隐藏路由决策。
---

# ai-provider 子路径合同

## 1. 入口与配置

来源：`sdk/src/ai-provider/index.ts`。

入口：`createNimiAiProvider(config)`。

必填配置：

1. `runtime`
2. `appId`
3. `subjectUserId`

可选默认：

1. `routePolicy`（默认 `local-runtime`）
2. `fallback`（默认 `deny`）
3. `timeoutMs`
4. `metadata`

## 2. 对外模型面

返回 provider 同时支持：

1. `text(modelId)`
2. `embedding(modelId)`
3. `image(modelId)`
4. `video(modelId)`
5. `tts(modelId)`
6. `stt(modelId)`

并保持 callable 语义：`provider(modelId) === provider.text(modelId)`。

## 3. Runtime 映射

### 3.1 文本/向量

1. `text.doGenerate/doStream` -> `runtime.ai.generate/streamGenerate`
2. `embedding.doEmbed` -> `runtime.ai.embed`

### 3.2 媒体任务（image/video/tts/stt）

统一走：

1. `submitMediaJob`
2. `getMediaJob` 轮询
3. `getMediaArtifacts`
4. 必要时 `cancelMediaJob`

状态语义：`COMPLETED` 返回 artifacts；`FAILED/CANCELED/TIMEOUT` 返回结构化错误。

## 4. 失败与取消语义

1. runtime 不可用或 provider 异常统一映射为 `NimiError`。
2. AbortSignal 触发时会尝试 `cancelMediaJob`，然后抛错。
3. SDK 超时同样会发起远端 cancel。
4. 非兼容能力必须 fail-close，不得伪造成功。

## 5. provider metadata 约定

返回 metadata 包含：

1. `traceId`
2. `routeDecision`（`local-runtime`/`token-api`）
3. `modelResolved`

## 6. 验收门禁

### 6.1 单元测试

1. `sdk/test/ai-provider/provider.test.ts`

覆盖：文本/流式/embedding/image/video/tts/stt 映射、失败归一化、abort cancel、idempotency 元数据透传。

### 6.2 runtime 合同测试（按 provider）

1. LiteLLM：`provider_cloud_test.ts`（text/embed/image/video/tts/stt）
2. Nexa：`provider_local_test.ts`（text/embed/image/tts/stt + video fail-close）
3. OpenAI-compatible：`provider_openai_test.ts`（video endpoint fallback、stream fallback、unsupported fail-close）
4. Gemini：`provider_gemini_test.ts`（operation image/video）
5. GLM：`provider_glm_test.ts`（task video + image/tts/stt）
6. MiniMax：`provider_minimax_test.ts`（task image/video）
7. Kimi：`provider_kimi_test.ts`（chat-multimodal image + invalid output fail-close）
8. Bytedance OpenSpeech：`provider_bytedance_openspeech_test.ts`（tts/stt）

### 6.3 live smoke

1. `nimi-sdk-ai-provider-live-smoke.test.ts`（local + litellm 真实环境）
