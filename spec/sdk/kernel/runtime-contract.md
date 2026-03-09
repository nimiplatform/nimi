# SDK Runtime Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-010 Runtime Client Construction

Runtime SDK 不允许隐式全局单例，但允许 first-run 默认值：

- Node.js 环境下，`new Runtime()` 默认使用 `node-grpc` 连接本地 daemon。
- 默认 `appId` 为 `process.env.NIMI_APP_ID || 'nimi.app'`。
- 默认 endpoint 为 `process.env.NIMI_RUNTIME_ENDPOINT || '127.0.0.1:46371'`。
- 非 Node.js 环境下若未显式提供 transport，必须 fail-close 并返回可行动错误。

## S-RUNTIME-011 Module Projection

Runtime 子路径公开方法集合由 `runtime-method-groups.yaml` 约束，必须与 runtime kernel RPC 面对齐。

允许在 `Runtime` 类上提供 ergonomic convenience 方法（如 `generate()` / `stream()`），但必须是对既有 runtime text surface 的薄投影，不得分叉推理语义、错误语义或 trace/usage 语义。

high-level convenience targeting 必须满足：

- `runtime.generate({ prompt })` / `stream({ prompt })`：本地默认文本模型
- `runtime.generate({ model: '<local-model-id>', ... })`：本地显式模型
- `runtime.generate({ provider: '<provider>', ... })`：provider 默认文本模型
- `runtime.generate({ provider: '<provider>', model: '<model>', ... })`：provider 显式模型

其中 high-level `model` 只表示具体模型，不承担 provider/route alias 语义；fully-qualified remote model id 必须留在低层 `runtime.ai.text.*` surface，不得作为 high-level convenience public contract。

## S-RUNTIME-012 Metadata Projection

connector/body 字段与 metadata 字段必须按 transport 合同分层传递。

## S-RUNTIME-015 ready() Fail-Close

Runtime `ready()` 探测失败必须抛出 `RUNTIME_UNAVAILABLE`，不得 fail-open。

## S-RUNTIME-023 Deferred Service Projection

Phase 2 deferred 服务必须显式标记不可用语义，不得冒充 active。

## S-RUNTIME-028 Disconnected Event

连接中断时 SDK 必须发射 `runtime.disconnected` 事件，重建决策交给调用方。

## S-RUNTIME-045 Retry Backoff Baseline

Runtime gRPC 重试基线为指数退避（200ms 初始，3000ms 上限），不自动重连流式订阅。

## S-RUNTIME-050 Blocked vs Deferred

blocked 与 deferred 是不同状态：blocked 由依赖缺失造成，deferred 属于路线图阶段控制。

## S-RUNTIME-066 Pagination Projection

Runtime List RPC 的分页默认值与 Realm REST 客户端分页默认值可不同，必须在文档层显式说明。

## S-RUNTIME-067 鉴权与主体上下文分离

Runtime SDK 必须将“鉴权 token”与“业务主体标识”分离建模：

- `auth.accessToken`：用于 Runtime AuthN（`authorization` 注入）。
- `subjectContext`：用于填充请求体 `subjectUserId`。

两者语义独立，不得复用同一配置字段。

## S-RUNTIME-068 Subject Context 命名规范

RuntimeOptions 公开字段必须使用 `subjectContext` 命名，不得继续暴露 `authContext` 旧命名。
