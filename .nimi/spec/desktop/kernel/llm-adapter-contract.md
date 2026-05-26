# LLM Adapter Contract

> Authority: Desktop Kernel

## Scope

Desktop LLM 适配器契约。定义 provider 适配、路由策略、Connector 凭据路由、以及 runtime-aligned text/media/voice 集成边界。

## D-LLM-001 — Provider 适配层

LLM 请求通过 provider 适配层路由，对齐 K-KEYSRC-001 两路径模型：

- **managed 路径**（`connector_id` 存在）：通过 ConnectorService 解析 provider / endpoint / credential（K-KEYSRC-009）。`connector_id` 由用户在 Runtime Config UI 选择 connector 后写入运行时字段。
- **inline 路径**（Phase 2，K-KEYSRC-001 inline metadata）：Desktop Phase 1 不使用 inline 路径。
- `provider` 字段仍用于 UI 展示和路由选择，但执行层凭据注入由 `connector_id` 驱动。Runtime K-PROV-005 定义 provider 归一化映射（provider 名称到 ProviderType 枚举的规范化），Desktop 应使用归一化后的 provider 名称发送请求，确保 Runtime 侧正确路由。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定；endpoint 允许为空，空值表示当前 route 未配置本地 endpoint。
- `localOpenAiEndpoint`：OpenAI 兼容端点；允许为空，空值表示 runtime 未提供 OpenAI-compatible local binding。

cloud connector 路径必须保持 runtime-only：Desktop 不得恢复 legacy provider adapter factory 或直接 provider `listModels` / `healthCheck` 调用来旁路 Runtime。

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

**跨层引用**：K-KEYSRC-001、K-KEYSRC-009、K-PROV-005。

## D-LLM-002 — 路由策略

执行内核 turn 路由：

- Desktop core product 不拥有 Agent chat route API，也不得在 DataSync / launcher / fallback policy 中内建 Agent 聊天路由。
- `data-api.core.agent.chat.route.resolve` 必须 fail-close：缺少 `agentId`、控制面请求失败、或返回 payload 非法时直接报错；Desktop host 不得合成本地 `LOCAL/AGENT_LOCAL` 成功路由。
- `AgentEffectiveCapabilityResolution` 的唯一 authority home 是 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）定义的 shared builder；setup / submit / runtime 不得各自重算一份 agent route truth。
- `ExecuteLocalTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

## D-LLM-003 — Connector 凭据路由

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 body 传递 `connectorId`（S-TRANSPORT-002）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、K-CONN-001（.nimi/spec/runtime/connector.md）。

## D-LLM-004 — 本地 LLM 健康检查

`checkLocalLlmHealth` 验证本地引擎可用性：

- 对 local `text.generate` / `text.embed`，必须先解析到 `RuntimeLocalService` authoritative local model record；health/status/readiness 以 runtime local model list/status 为真源。
- host-local snapshot、推荐 feed、或 route config 中残留的 `localProviderModel` 只可补充展示元数据，不得单独构成 healthy/sendable 结论。
- local text 路径中，`goRuntimeStatus in {active, installed}` 可视为可执行或可 warm-on-demand；`degraded / unavailable / unhealthy / removed / missing` 必须 fail-close 为 unreachable。
- local `llama` text 健康检查不得仅靠 `GET /v1/models` 2xx 判定 healthy。
- media / speech 路径继续遵循各自的 canonical endpoint 探测协议。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。对 local text，它消费 runtime authoritative local model state，而不是复制一套 host-side probe truth；对 media/speech，它仍遵循 `K-LENG-007` 的 engine-specific 协议进行 endpoint 探测。缺 endpoint 或缺 runtime authoritative local record 时必须直接视为未配置/不可达，不得伪造 loopback fallback。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

## D-LLM-005 — 语音引擎集成

Desktop 侧 speech engine 只暴露 runtime-aligned 语音能力：

- `setSpeechFetchImpl(proxyFetch)`：设置语音请求的 fetch 实现。
- `setSpeechRouteResolver(resolver)`：设置语音路由解析器。
- 路由解析：从 capability-scoped route binding 读取 connector/model/endpoint 配置，不再暴露 provider list。
- legacy speech provider-list surface 已下线，不提供替代接口。

公开 surface 固定为：
- `runtime.media.tts.list.voices`
- `runtime.media.tts.synthesize`
- `runtime.media.tts.stream`
- `runtime.media.stt.transcribe`

选路规则固定为：
- `audio.synthesize`：先走 `runtime.route.listOptions({ capability: 'audio.synthesize' })` 选 binding，再调用 `runtime.media.tts.listVoices/synthesize/stream`
- `voice_workflow.voice_clone|voice_workflow.voice_design`：必须对对应 capability 独立执行 `runtime.route.listOptions -> resolve -> checkHealth -> describe`，再提交 runtime media job；不得复用 `audio.synthesize` 的 route truth
- 缺有效 binding 或缺 route-resolved model 时必须 fail-close，不得返回空 voice 列表作为静默 fallback
- AI Chat、Agent Chat、Runtime Config 对 text/audio/voice workflow 的 capability projection 必须共用 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）规定的 shared builder，不得在本地 heuristic 中重建 route metadata truth
- 本契约只拥有 runtime-aligned voice route/API truth；agent chat richer workflow 是否被
  admit、属于 `voice_clone` 还是 `voice_design`、使用什么 voice identity、以及 workflow result
  如何回到当前 conversation anchor，固定由 `agent-chat-voice-workflow-contract.md`
  （`D-LLM-047` ~ `D-LLM-052`）拥有
- 本契约只拥有 runtime-aligned TTS route/API truth；agent chat resolved `voice`
  action consumption、`audio.synthesize` 首包 executor semantics、以及 playback-ready
  speech artifact outcome 固定由
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）拥有
- 本契约同样不拥有 broader voice session product semantics；explicit entry / exit、
  same-anchor continuity、admitted listening modes、interruption、以及
  transcript / caption rules 固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有

## D-LLM-006 — 本地 AI 推理审计

`LocalRuntimeInferenceAuditPayload` 记录推理事件：

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_cloud`（映射到 Runtime 审计字段 `operation`）
- `source`：`local` / `cloud`（映射到 Runtime 审计载荷 `payload.source`）
- `modality`：`chat` / `image` / `video` / `tts` / `stt` / `embedding`
- `adapter`：`openai_compat_adapter` / `llama_native_adapter` / `media_native_adapter` / `media_diffusers_adapter` / `sidecar_music_adapter`
- `policyGate`：策略门控信息

**审计角色定位**：Desktop `LocalRuntimeInferenceAuditPayload` 是**展示层补充审计记录**，用于 UI 侧的推理事件追踪和本地调试。它不替代 Runtime 层的持久化审计：

- **Runtime K-AUDIT-001**（全局审计最小字段）和 **K-LOCAL-016**（本地审计）由 daemon 层写入，包含完整的 `request_id`、`trace_id`、`user_id`、`usage` 等运行时上下文字段。
- **Desktop D-LLM-006** 侧重于记录 renderer 可观测的推理决策信息（eventType、source、adapter、policyGate），不具备 runtime 上下文字段。
- 两者通过 SDK `RuntimeLocalService.AppendInferenceAudit` 桥接：Desktop 将审计载荷提交到 runtime，最终存入 Runtime 审计存储。

## D-LLM-007 — 分层调试责任与门禁顺序

Desktop 调试必须遵循固定分层门禁顺序：

- Runtime gate（K-GATE-040/K-GATE-060/K-GATE-070）未通过时，SDK 与 Desktop 不得以 workaround 继续推进。
- SDK gate（S-GATE-020/S-GATE-080/S-GATE-090）未通过时，Desktop 只能修复 SDK 对接问题，不得在 Desktop 侧 hardcode 补洞。
- Desktop 仅在 Runtime+SDK 双绿灯后进入 E2E 排障。

禁止路径：

- 以 legacy 接口或 hardcode provider/model/route 规避上游未收敛问题。
- 在 Desktop 侧复制 Runtime/SDK 的路由或能力判定逻辑。

跨层引用：K-GATE-040、K-GATE-060、K-GATE-070、S-GATE-080、S-GATE-090。

## D-LLM-008 — Trace 连续性

LLM 适配器必须在跨模态链路保持统一 trace：

- 对外返回统一 `traceId`（text/image/video/stt/embedding/speech）；`promptTraceId` 仅作为文本兼容字段并与 `traceId` 语义对齐。
- Runtime 未返回 trace 时，Desktop 执行层必须生成可追踪 fallback trace，避免断链。
- 推理审计载荷必须包含 `traceId + modality + routeSource + reasonCode`，确保 Runtime↔SDK↔Desktop 可检索。

跨层引用：K-AUDIT-001、S-ERROR-005、D-IPC-011、D-ERR-007。

## D-LLM-065 — World Generate Runtime-Only Boundary

Desktop 消费 `world.generate` 时必须保持 runtime-only 路径：

- route resolve、submit、poll、fetch-world 均必须通过 runtime surface 完成。
- `connector_id` 继续是唯一合法的远端凭据路由句柄。
- Desktop 不得直接调用 World Labs upload / generate / operations / get-world
  HTTP endpoints。
- provider viewer URL 若被展示，只能作为外部 handoff；它不构成 Desktop 拥有
  provider execution truth。

## Fact Sources

- `tables/error-codes.yaml` — LLM 相关错误码
- `tables/rule-evidence.yaml` — LLM 分层门禁与证据映射
