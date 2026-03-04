# LLM Adapter Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop LLM 适配器契约。定义 provider 适配、路由策略、Connector 凭据路由、语音引擎集成。

## D-LLM-001 — Provider 适配层

LLM 请求通过 provider 适配层路由，对齐 K-KEYSRC-001 两路径模型：

- **managed 路径**（`connector_id` 存在）：通过 ConnectorService 解析 provider / endpoint / credential（K-KEYSRC-009）。`connector_id` 由用户在 Runtime Config UI 选择 connector 后写入运行时字段。
- **inline 路径**（Phase 2，K-KEYSRC-001 inline metadata）：Desktop Phase 1 不使用 inline 路径。
- `provider` 字段仍用于 UI 展示和路由选择，但执行层凭据注入由 `connector_id` 驱动。Runtime K-PROV-005 定义 provider 归一化映射（provider 名称到 ProviderType 枚举的规范化），Desktop 应使用归一化后的 provider 名称发送请求，确保 Runtime 侧正确路由。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定。
- `localOpenAiEndpoint`：OpenAI 兼容端点。

**跨层引用**：K-KEYSRC-001、K-KEYSRC-009、K-PROV-005。

## D-LLM-002 — 路由策略

执行内核 turn 路由：

- 通过 `resolveChatRoute` DataSync 方法确定目标 agent 和 provider。
- `ExecutePrivateTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

## D-LLM-003 — Connector 凭据路由

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 body 传递 `connectorId`（S-TRANSPORT-002）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、K-CONN-001（spec/runtime/connector.md）。

## D-LLM-004 — 本地 LLM 健康检查

`checkLocalLlmHealth` 验证本地引擎可用性：

- 检查本地端点可达性。
- 验证模型已加载且状态为 `active`。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。Desktop 端本地健康探测应遵循 K-LENG-007 协议（`GET /v1/models`，5s 超时，HTTP 200 + 有效模型列表 = 健康）。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

## D-LLM-005 — 语音引擎集成

Hook runtime 提供语音能力：

- `setSpeechFetchImpl(proxyFetch)`：设置语音请求的 fetch 实现。
- `setSpeechRouteResolver(resolver)`：设置语音路由解析器。
- 路由解析：从当前 runtime fields 读取 provider、model、endpoint 配置。

语音 capability 键：
- `llm.speech.providers.list` / `llm.speech.voices.list`
- `llm.speech.synthesize` / `llm.speech.transcribe`
- `llm.speech.stream.open` / `llm.speech.stream.control` / `llm.speech.stream.close`

## D-LLM-006 — 本地 AI 推理审计

`LocalAiInferenceAuditPayload` 记录推理事件：

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_token_api`（映射到 Runtime 审计字段 `operation`）
- `source`：`local-runtime` / `token-api`（映射到 Runtime 审计载荷 `payload.source`）
- `modality`：`chat` / `image` / `video` / `tts` / `stt` / `embedding`
- `adapter`：`openai_compat_adapter` / `localai_native_adapter`
- `policyGate`：策略门控信息

**审计角色定位**：Desktop `LocalAiInferenceAuditPayload` 是**展示层补充审计记录**，用于 UI 侧的推理事件追踪和本地调试。它不替代 Runtime 层的持久化审计：

- **Runtime K-AUDIT-001**（全局审计最小字段）和 **K-LOCAL-016**（本地审计）由 daemon 层写入，包含完整的 `request_id`、`trace_id`、`user_id`、`usage` 等运行时上下文字段。
- **Desktop D-LLM-006** 侧重于记录 renderer 可观测的推理决策信息（eventType、source、adapter、policyGate），不具备 runtime 上下文字段。
- 两者通过 `D-IPC-011` 的 `local_ai_append_inference_audit` 命令桥接：Desktop 将审计载荷提交到 Tauri backend，最终存入 Runtime 审计存储。

## Fact Sources

- `tables/hook-capability-allowlists.yaml` — LLM capability 白名单
- `tables/error-codes.yaml` — LLM 相关错误码
