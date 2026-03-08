# SDK Transport Contract

> Owner Domain: `S-TRANSPORT-*`

## S-TRANSPORT-001 Runtime Transport 显式声明

Runtime SDK transport 必须显式声明：

- `node-grpc`
- `tauri-ipc`

禁止隐式默认 transport。

## S-TRANSPORT-002 Metadata 投影边界

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/api_key 在 transport metadata
- Runtime 鉴权 token 不属于业务 metadata；必须通过 transport auth 通道注入到 gRPC metadata `authorization`

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

**Runtime 侧协议**：Runtime 通过 gRPC response header metadata `x-nimi-runtime-version` 暴露 semver 版本（`K-DAEMON-011`）。SDK 从首次成功 RPC 的 response metadata 中提取并缓存版本。Desktop 通过 `runtime_bridge_status` 的 `daemonVersion` 字段获取版本（`D-IPC-002`/`D-IPC-009`），两条路径语义等价。若 metadata 缺失（旧版 Runtime），SDK 按 best-effort 处理：假设兼容，首次方法不可用错误时报告版本问题。

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

- Runtime SDK 必须支持 `auth.accessToken`（`string` 或 token provider 函数）作为统一鉴权来源。
- 每次 unary/stream 调用前都必须重新解析 token（不得在 client 构造时静态固化）。
- Bearer 注入必须按方法/路由判定，不得对所有 Runtime 调用无条件注入：
  - `cloud` AI consume 路径必须注入 Bearer。
  - local 生命周期写 RPC 必须注入 Bearer。
  - anonymous local AI consume（`route_policy=LOCAL` 且无 `connector_id`、无 inline remote 凭据 metadata）不得注入 Bearer。
  - `RuntimeLocalService` 的只读 RPC（含 `WarmLocalModel`）不得注入 Bearer。
- 未解析到 token 时，SDK 发送匿名请求；匿名是否被接受由 runtime 侧按 `K-AUTHN-*` / `K-KEYSRC-*` / `K-LOCAL-*` 判定。
- anonymous 行为仅在 `Authorization` 头缺失时成立。若 SDK 注入或上游显式提供了非法 Bearer，runtime 必须按 `K-AUTHN-001` / `K-AUTHN-007` 返回 `UNAUTHENTICATED + AUTH_TOKEN_INVALID`，不得降级为 anonymous。
- 上层应用不得通过 `metadata.extra` 手工拼接 `authorization`；该字段属于 transport 内部实现细节。
