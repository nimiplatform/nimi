# Runtime SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/runtime` 的领域增量规则（构造、模块编排、与 runtime kernel 的投影关系）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

同时引用 runtime kernel（仅引用，不复述）：

- `spec/runtime/kernel/rpc-surface.md`
- `spec/runtime/kernel/key-source-routing.md`
- `spec/runtime/kernel/error-model.md`
- `spec/runtime/kernel/streaming-contract.md`

## 1. 领域不变量

- `SDKR-001`: Runtime SDK 入口固定为 `new Runtime(options)`。
- `SDKR-002`: transport 必须显式声明 `node-grpc | tauri-ipc`（`S-TRANSPORT-001`）。
- `SDKR-003`: 运行时推理方法以 runtime kernel 的 AIService/ConnectorService 投影为权威，不再在本文件重复列全量方法正文。导入边界遵循 `S-BOUNDARY-001`（子路径导入边界）与 `S-BOUNDARY-002`（Runtime/Realm 边界）。
- `SDKR-004`: 不暴露 token-provider legacy 对外接口名，具体禁令以 `S-SURFACE-003` 为权威。

## 2. 初始化与连接管理（领域增量）

- `SDKR-010`: `appId` 为空必须 fail-close（`SDK_APP_ID_REQUIRED`）。
- `SDKR-011`: `node-grpc` 缺 endpoint 必须 fail-close（`SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED`）。
- `SDKR-012`: `auto`/`manual` 连接模式影响连接触发时机与透明重试行为（SDKR-046），不改变方法签名与返回类型。
- `SDKR-013`: `connect()` 创建 transport client，状态 `idle→connecting→ready`；重复调用幂等。
- `SDKR-014`: `close({ force? })` 释放 client，状态 `→closing→closed`；已关闭时幂等。
- `SDKR-015`: `ready({ timeoutMs? })` = connect + health check；health=unavailable 必须抛出 `RUNTIME_UNAVAILABLE`。
- `SDKR-016`: `state()` 返回 `RuntimeConnectionState` 快照（5 状态：idle/connecting/ready/closing/closed）。
- `SDKR-017`: auto 模式首次 RPC 自动 connect；manual 模式需显式 connect 否则 fail-close。

## 3. Runtime 模块编排（领域增量）

- `SDKR-020`: 高阶模块（ai/media/auth/grant/localRuntime）只做输入归一化与错误投影，不复制 runtime 规则定义。
- `SDKR-021`: 方法分组与投影表以 `kernel/tables/runtime-method-groups.yaml` 为权威（`S-SURFACE-009`）。
- `SDKR-022`: runtime 规则冲突时，以 `spec/runtime/kernel/*` 为准。
- `SDKR-023`: workflow 模块属于 Phase 2 服务投影（见 `kernel/tables/runtime-method-groups.yaml`），不在 Phase 1 实现范围内。
- `SDKR-024`: `raw.call(methodId, input, options)` 旁路高阶模块直接发起 RPC，不做输入归一化。
- `SDKR-025`: `raw.closeStream(streamId)` 关闭活跃流。
- `SDKR-026`: `call(method, input, options)` 是 `raw.call` 的类型安全包装，接受 `RuntimeMethod<TReq,TRes>` 或 string。
- `SDKR-027`: `events.on(name, handler)` / `events.once(name, handler)` 订阅运行时事件，返回 unsubscribe 函数。
- `SDKR-028`: Phase 1 标准事件名（完整集合）：
  - Transport 驱动事件：`runtime.connected`（transport ready）、`runtime.disconnected`（transport closed/broken）
  - SDK 合成事件：`auth.token.issued`（session 建立后合成）、`auth.token.revoked`（session 撤销后合成）
  - 通用事件：`error`（SDK 或 transport 层错误）
  - 新增事件名需同步更新本列表。

## 4. Metadata 与凭据传递（领域增量）

- `SDKR-030`: credential 分离语义遵循 `S-TRANSPORT-002` 与 runtime `K-KEYSRC-001`（路径模型）、`K-KEYSRC-002`（互斥）、`K-KEYSRC-003`（metadata keys）、`K-KEYSRC-004`（评估顺序，10 步固定评估链决定错误出现次序）。
- `SDKR-031`: Connector 管理 RPC 的 `app_id` 仅通过 metadata 传递。
- `SDKR-032`: `RuntimeOptions.authContext` 提供 `subjectUserId` 或异步 `getSubjectUserId()` 回调。
- `SDKR-033`: authContext 仅用于 metadata 填充，不改变 RPC 请求语义；遵循 `S-TRANSPORT-002`。
- `SDKR-034`: SDK 必须透传 runtime key-source metadata keys。完整键集合以 `spec/runtime/kernel/tables/metadata-keys.yaml` 为权威源（7 个 key）：`x-nimi-key-source`、`x-nimi-provider-type`、`x-nimi-provider-endpoint`、`x-nimi-provider-api-key`、`x-nimi-app-id`、`x-nimi-client-id`（可选审计上下文）、`x-nimi-idempotency-key`（可选幂等去重，来源 `K-DAEMON-006`）。字段语义以 `K-KEYSRC-003` 为权威。
- `SDKR-035`: `connector_id`（body）与 inline 凭据（metadata）互斥。同时提供必须 fail，runtime 返回 `AI_REQUEST_CREDENTIAL_CONFLICT`（`K-KEYSRC-002`）。SDK MAY 在发送前前置校验并 fail-close，但此校验非必须——runtime 侧为最终权威。
- `SDKR-036`: Inline 凭据路径仅适用于 `runtime_plane=remote` 的 provider。Local provider 必须使用 managed connector 路径（`K-KEYSRC-009`）。SDK 不在客户端复制 provider-capabilities 表。

## 5. 错误与重试（领域增量）

- `SDKR-040`: SDK 本地错误码来源于 `kernel/tables/sdk-error-codes.yaml`。
- `SDKR-041`: Runtime ReasonCode 直接投影，不在 SDK domain 中重新定义枚举值。
- `SDKR-042`: SDK/runtime 版本协商与方法可用性检查必须遵循 `S-TRANSPORT-005` 与 `S-ERROR-006`。
- `SDKR-043`: trace 透传与可观测性输出必须遵循 `S-TRANSPORT-006`。
- `SDKR-044`: `RuntimeOptions.retry` 配置 `maxAttempts`（默认 3）和 `backoffMs`（默认 200ms）（`S-ERROR-004`）。
- `SDKR-045`: 指数退避 `backoffMs * 2^(attempt-1) + uniform jitter [0, backoffMs/2]`，硬上限 3000ms。
- `SDKR-046`: 仅 auto 连接模式启用 transparent retry；manual 模式不重试。
- `SDKR-047`: `OPERATION_ABORTED` 永不重试（引用 S-ERROR-008）。
- `SDKR-048`: `RuntimeOptions.telemetry.enabled/onEvent` 控制遥测事件发射。
- `SDKR-049`: telemetry 是辅助面，不改变请求成功/失败语义（引用 S-TRANSPORT-006）。

## 6. Blocked 依赖

- `SDKR-050`: **ConnectorService 投影** — spec 定义 7 个方法（`CreateConnector`、`GetConnector`、`ListConnectors`、`UpdateConnector`、`DeleteConnector`、`TestConnector`、`ListConnectorModels`），但 proto 文件尚未创建，SDK 无法实现。Blocked on proto dependency，不在本轮实现。
- `SDKR-051`: ConnectorService blocked 期间，SDK 对 ConnectorService 方法调用返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`（`S-ERROR-006`）。不提供 fallback 或 shim。

## 7. Auth 服务投影（领域增量）

- `SDKR-060`: `RegisterApp` 调用模型：SDK 不在 `connect()` 中隐式调用 `RegisterApp`。应用层需显式调用或通过高阶模块触发。Session 生命周期管理（open/refresh/revoke）由应用层驱动。Session TTL 语义：`ttl_seconds` 必须落在服务端配置区间内（`K-AUTHSVC-004`），默认 TTL 3600s（`K-AUTHSVC-011`）。Phase 1 session 存储为进程内内存 map，daemon 重启后所有 session 失效，客户端需重新建立会话（`K-AUTHSVC-012`）。
- `SDKR-061`: AppMode gate（`K-AUTHSVC-009`）由 runtime 侧强制执行。SDK 不复制 AppMode 校验逻辑，仅投影错误码 `APP_MODE_DOMAIN_FORBIDDEN` / `APP_MODE_SCOPE_FORBIDDEN` / `APP_MODE_MANIFEST_INVALID`。
- `SDKR-062`: External principal session workflow 需要应用层组装 proof（`K-AUTHSVC-006`）。SDK 提供透传通道，不内置 proof 生成逻辑。

## 8. Grant 服务投影（领域增量）

- `SDKR-063`: Grant 服务方法直接通过 `raw.call` 或高阶 grant 模块调用。SDK 不内置自动授权流。委托深度限制（`max_delegation_depth`，默认 3）由 runtime 侧强制执行（`K-GRANT-005`）。
- `SDKR-064`: `ListTokenChain` 分页遵循 `K-PAGE-002`（page_token 语义）与 `K-PAGE-005`（通用分页默认值）。响应中 `has_more=true` 表示委托链因深度截断（超出 `max_delegation_depth`，`K-GRANT-012`）而存在更多未返回节点。SDK 不封装自动翻页。
- `SDKR-065`: Scope 有效性校验（`K-GRANT-009` scope prefix gate）由 runtime 侧强制执行。SDK 投影 `APP_SCOPE_FORBIDDEN` / `APP_SCOPE_REVOKED`。
- `SDKR-066`: Phase 1 List RPC 分页通用规则。所有支持分页的 List RPC（完整枚举见 `K-PAGE-006`）遵循统一默认值（`K-PAGE-005`）：`page_size` 默认 50、最大 200；`page_token` 语义见 `K-PAGE-002`。SDK 透传分页参数，不封装自动翻页或客户端聚合。无效 `page_token` 由 runtime 返回 `PAGE_TOKEN_INVALID`（`K-PAGE-002`）。

## 9. 类型定义参考

`RuntimeOptions` 完整接口汇总（散落在 SDKR-010/011/012/032/044/048 的字段）：

```typescript
interface RuntimeOptions {
  /** 应用标识，必填（SDKR-010） */
  appId: string;
  /** 传输层类型（SDKR-002, S-TRANSPORT-001） */
  transport: 'node-grpc' | 'tauri-ipc';
  /** node-grpc 端点地址，node-grpc 时必填（SDKR-011） */
  endpoint?: string;
  /** 连接模式（SDKR-012） */
  connectionMode?: 'auto' | 'manual';
  /** 认证上下文（SDKR-032） */
  authContext?: {
    subjectUserId?: string;
    getSubjectUserId?: () => Promise<string>;
  };
  /** 重试配置（SDKR-044） */
  retry?: {
    maxAttempts?: number;   // 默认 3
    backoffMs?: number;     // 默认 200ms
  };
  /** 遥测配置（SDKR-048） */
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: unknown) => void;
  };
}
```

## 10. 非目标

- 不定义 runtime proto 全量方法细节（见 runtime kernel）
- 不定义 provider 业务语义（见 runtime domain 与 runtime kernel）
- 不定义 realm/mod/scope 领域规则
