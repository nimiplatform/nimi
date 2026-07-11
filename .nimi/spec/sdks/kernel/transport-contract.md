# SDK Transport Contract

> Owner Domain: `S-TRANSPORT-*`

## S-TRANSPORT-001 Runtime Transport 显式声明

Runtime SDK transport 必须满足以下构造边界：

- `node-grpc`
- `tauri-ipc`
- `electron-ipc`
- native `protected-local-host` carrier (host-injected; never renderer-constructed)

Electron transport rules:
- Non-Node Runtime consumers must pass an explicit transport. Supported explicit transports are `node-grpc`, `tauri-ipc`, and `electron-ipc`.
- `electron-ipc` / `tauri-ipc` generic renderer bridges can carry only
  independently admitted public/binding-only operations. They must reject
  protected method ids and authorization-bearing renderer payloads.
- Protected Desktop calls use the host-injected native carrier. SDK receives a
  typed carrier handle, never endpoint/session/process/trust material, and
  cannot derive or inject origin. Installed/developer app child carriers are
  absent pending A.1.

规则：

- Production has no `NIMI_RUNTIME_ENDPOINT` or implicit endpoint discovery for
  protected calls. A Node loopback default is allowed only for separately
  signed synthetic non-product fixtures and public/binding-only testing.
- Non-Node surfaces require an explicit ordinary transport or injected native
  carrier. Missing method-required carrier fails closed.

## S-TRANSPORT-002 Metadata 投影边界

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/key never enters SDK transport metadata; Runtime resolves
  connector/credential refs inside service-principal custody
- an `authorization` bearer may serve only an explicitly fenced Web/cloud,
  external-principal, or ordinary public AuthN contract; it never establishes
  K-PLOCAL protected origin or invokes the public Grant tombstones

幂等键透传：SDK 支持通过 `options.idempotencyKey` 传递 `x-nimi-idempotency-key` metadata（`K-DAEMON-006`）。缺省时不设置该 header，runtime 不做去重。

## S-TRANSPORT-003 流式行为边界

- SDK 不得隐式重连续流。
- 中断后必须由调用方显式重建订阅。

## S-TRANSPORT-004 Realm 请求引擎边界

Realm SDK 必须通过实例级配置完成 endpoint/token/header 合并，不允许共享全局 OpenAPI 运行态配置。

## S-TRANSPORT-005 SDK/Runtime 版本兼容边界

SDK 与 Runtime 的版本协商必须显式可判定：

- major 不兼容必须 fail-close，不允许静默降级为”部分可用”。
- minor/patch 差异允许通过能力探测或方法可用性检查做受控降级。
- 版本兼容判断结果必须可被上层读取（用于提示与治理），不得仅写日志。

发现机制：

- 版本信息通过初始连接的 metadata 交换获取。
- 方法可用性通过已知方法集合（`runtime-method-groups.yaml`）静态判定，不依赖运行时反射。
- 降级仅限于 Phase 2 deferred 方法标记为不可用，不改变 Phase 1 方法语义。

**Protected protocol**：Production Desktop/Runtime compatibility is proven
before SDK traffic by mutual platform-native process and code-signing verification: exact
`protected_local_protocol_version` plus reciprocal peer release-id admission.
Typed status returns the verified release id. Semver metadata is advisory for
ordinary public transports only; missing protected compatibility never uses
best-effort or assumes compatibility.

**blocked vs deferred 语义区分**：

- `blocked`：Phase 1 服务但 proto 依赖未就绪，SDK 返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`。blocked 服务的方法一旦 proto 发布即可实现，不需要版本协商。当前无 blocked 服务（ConnectorService proto 已就绪，`S-RUNTIME-050`）。
- `deferred`：Phase 2 服务（如 WorkflowService），在版本兼容降级中标记为不可用。deferred 服务的可用性取决于 runtime 版本支持。

## S-TRANSPORT-006 Trace 与可观测性边界

- SDK 必须支持将调用链 trace 标识透传到下游（如 metadata/header）。
- 任何可观测性输出禁止包含明文凭据（api key/token）。
- 可观测性是辅助面，不得改变请求成功/失败语义与重试判定。

## S-TRANSPORT-007 流式终帧投影

SDK 必须将 runtime 流式终帧（`done=true`）中的 `reason_code` 和 `usage` 投射给消费者：

- `done=true + REASON_CODE_UNSPECIFIED` = 正常完成。
- `done=true + 错误 reason_code` = 业务错误（非 gRPC 错误），SDK 必须作为流级错误投影，不可静默丢弃。
- 终帧语义权威定义：`K-STREAM-002`（建流阶段边界）、`K-STREAM-003`（文本流事件约束，含 usage 与 done 语义）、`K-STREAM-004`（语音流事件约束）。
- `SubscribeScenarioJobEvents` 不使用 `done=true` 语义（`K-STREAM-005`），终态后 server 关流。

Mode B 投影规则（`SubscribeScenarioJobEvents`、`SubscribeWorkflowEvents`）：

- 终态事件（`K-JOB-002` 定义的 `COMPLETED`/`FAILED`/`CANCELED`/`TIMEOUT`）到达后，server 以 gRPC OK 正常关闭流（`K-STREAM-005`）。
- SDK 必须在收到终态事件后停止流读取，将终态事件作为最终结果投影给消费者。
- SDK 不得将 gRPC OK close 视为错误——终态事件即为流的语义终止信号。
- 当消费者随后通过 `GetScenarioJob` 轮询终态失败时，结构化失败细节投影遵循 `S-ERROR-016`。
- `SubscribeWorkflowEvents` 为 Phase 2 服务，投影规则同上（`K-WF-004`）。

Mode C 投影规则（`ExportAuditEvents`）：Phase 2 服务（`audit_service_projection`），当前不定义 SDK 投影规则。

Mode D 投影规则按 Phase 分层：

- **Phase 1 健康订阅流**（`SubscribeRuntimeHealthEvents`、`SubscribeAIProviderHealthEvents`）：属于 Phase 1 frozen 的 daemon 健康监控功能（`K-DAEMON-001`~`010`、`K-PROV-003`），归入 `health_monitoring_projection` 分组。SDK 必须投影为 `runtime.healthEvents` / `runtime.providerHealthEvents` 订阅接口。Desktop 通过 IPC 桥（`D-IPC-002`）消费等价数据，两条路径语义等价。独立 SDK 消费者通过此投影获得 Phase 1 健康事件订阅能力。流关闭语义遵循 `K-STREAM-010`。
- **Phase 2 应用消息流**（`SubscribeAppMessages`）：属于 Phase 2 服务（`app_service_projection`），当前不定义 SDK 投影规则。

## S-TRANSPORT-008 流式超时投影

流式 RPC 超时由 runtime 侧强制执行（`K-STREAM-007`）：

- 首包超时默认 10s（由 runtime 侧配置控制，`K-DAEMON-008`），SDK 侧不可覆盖；超时触发 `DEADLINE_EXCEEDED + AI_PROVIDER_TIMEOUT`。
- 总超时默认 120s，独立计时，可由 runtime 配置调整（`K-DAEMON-008`，`K-DAEMON-009`）。
- SDK 不叠加独立客户端侧流超时（除非显式配置）。
- `AI_PROVIDER_TIMEOUT` 属于可重试 ReasonCode（`S-ERROR-007`）。

## S-TRANSPORT-009 Chunk 透传边界

- Runtime chunk 缓冲至最小 32 bytes（`K-STREAM-006`）。
- SDK 不重新拆分或合并 chunk，直接透传 runtime 边界。

## S-TRANSPORT-010 Runtime 鉴权注入边界

- `auth.accessToken` is available only in explicit Web/cloud or
  external-principal adapters whose own authority admits it. It is unreachable
  from every local Runtime app/Desktop facade.
- Local protected account, lifecycle, Realm, connector, AI and service-control
  calls never inject a bearer. They require the native verified carrier and the
  exact Runtime-derived origin/operation policy.
- Public/binding-only calls cannot be upgraded by a bearer, app id, caller enum
  or metadata. `GetAccessToken`, public refresh and all five public Grant
  methods remain deny-all regardless of token validity.
- `metadata.extra` and renderer IPC must reject `authorization`, provider keys,
  Realm bases, protected session ids and origin material rather than silently
  stripping and continuing.

## S-TRANSPORT-014 Local-Development Carrier Projection

The SDK local-development transport is host-injected by Kit and is never
renderer-constructed. It exposes only typed bootstrap/status and admitted
business calls. The SDK cannot accept or return a Runtime endpoint, project
authorization, launch correlation, process binding, session id/proof, Runtime
epoch, credential, token, capability fingerprint, or trust-class override.

Technical-session rotation and controlled host/Runtime restart are transparent
behind the typed transport. A revoked, expired, project-changed,
account-changed, untrusted-host, or unavailable carrier produces a stable typed
failure before a business call. Session material never enters renderer IPC,
application state, telemetry, errors, or retry callbacks.

Local-development transport does not widen the Runtime method set. During Wave
A it can carry only `artifacts.readRuntimeBytes`; every account, lifecycle,
Realm, AI, realtime, media, or generic proxy attempt remains unavailable even
when a valid development authorization exists. Ordinary Electron/Tauri IPC and
localhost gRPC cannot claim this transport type.

## S-TRANSPORT-011 背压投影

SDK 在流消费速度不足时必须将背压关闭转化为可判定的错误（`K-STREAM-011`）：

- server 端因慢消费者触发的 `RESOURCE_EXHAUSTED` 必须投影为 `NimiError`。
- SDK 不得静默累积无限缓冲——当 transport 层反馈背压信号时，SDK 必须向消费者传递压力或中止流。

## S-TRANSPORT-012 慢消费者关闭投影

慢消费者触发的流关闭必须投影为稳定错误形态（`K-STREAM-012`）：

- SDK 不得将背压关闭误报为正常完成（`done=true` + 正常 reason）。
- 关闭原因必须以 `NimiError` 形态投影，`reasonCode` 反映背压根因。

## S-TRANSPORT-013 Resume/Retry 边界

按流类型显式分类自动重试策略（`K-STREAM-013`）：

- **订阅型流（Mode D）**：恢复由调用方显式主导。SDK 可以发出 `runtime.disconnected` 等恢复信号，但不得在后台自动重建订阅或重放消费者状态。
- **执行型流（Mode A）**：由调用方决策是否重试，SDK 不得自动重放。
- SDK 自动重试仅限 unary/短生命周期读取调用；流式订阅与执行型流都必须由上层显式重建或重放。
