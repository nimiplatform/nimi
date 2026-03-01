# LLM Adapter Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop LLM 适配器契约。定义 provider 适配、路由策略、凭证库管理、语音引擎集成。

## D-LLM-001 — Provider 适配层

LLM 请求通过 provider 适配层路由：

- `provider` 字段确定执行路径（remote token API / local runtime）。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定。
- `localOpenAiEndpoint`：OpenAI 兼容端点。

## D-LLM-002 — 路由策略

执行内核 turn 路由：

- 通过 `resolveChatRoute` DataSync 方法确定目标 agent 和 provider。
- `ExecutePrivateTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

## D-LLM-003 — 凭证库

凭证通过 `credentialRefId` 引用：

- 凭证安全存储和访问策略由 `D-SEC-009` 定义。
- 运行时通过 `setRuntimeField('credentialRefId', value)` 绑定。
- LLM 请求自动注入绑定的凭证。

## D-LLM-004 — 本地 LLM 健康检查

`checkLocalLlmHealth` 验证本地引擎可用性：

- 检查本地端点可达性。
- 验证模型已加载且状态为 `active`。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。Runtime K-PROV-003 是 daemon 层的持久周期性探测（默认 8s 间隔），维护 Provider 健康状态机（K-PROV-001: unknown/healthy/unhealthy）。两者互补：Desktop 端使用即时检查驱动 UI 反馈，Runtime 端使用持久探测驱动路由降级和审计事件。

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

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_token_api`
- `source`：`local-runtime` / `token-api`
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
