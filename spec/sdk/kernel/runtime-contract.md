# SDK Runtime Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-010 Runtime Client Construction

Runtime SDK 必须显式声明 transport 与连接参数，不允许隐式全局单例。

## S-RUNTIME-011 Module Projection

Runtime 子路径公开方法集合由 `runtime-method-groups.yaml` 约束，必须与 runtime kernel RPC 面对齐。

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
