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

media convenience 也必须遵守同一原则：新增 ergonomic API 只能封装既有 `ScenarioJob` + artifact 主链，不得引入新的推理语义或绕过 runtime 校验。`runtime.media.music.iterate()` 属于允许的薄投影，必须复用 `MUSIC_GENERATE` 与 `nimi.scenario.music_generate.request` 扩展面。

high-level convenience targeting 必须满足：

- `runtime.generate({ prompt })` / `stream({ prompt })`：本地默认文本模型
- `runtime.generate({ model: '<local-model-id>', ... })`：本地显式模型
- `runtime.generate({ provider: '<provider>', ... })`：provider 默认文本模型
- `runtime.generate({ provider: '<provider>', model: '<model>', ... })`：provider 显式模型

其中 high-level `model` 只表示具体模型，不承担 provider/route alias 语义；fully-qualified remote model id 必须留在低层 `runtime.ai.text.*` surface，不得作为 high-level convenience public contract。

SDK 不解析 `~/.nimi/config.json`；模型默认值（`defaultLocalTextModel`、`defaultCloudProvider`、`provider.defaultModel`）由 runtime 按 K-CFG-002 优先级解析后通过 RPC 响应返回。SDK convenience 方法仅传递调用方意图，不做本地 config 回退。

high-level local targeting 只允许：

- bare local default：`local/default`
- qualified local model：`local/<model-root>`
- canonical engine prefix：`llama/`、`media/`、`speech/`、`sidecar/`

`localai/`、`nexa/`、`nimi_media/`、`localsidecar/` 属于 invalid legacy input；SDK 不得继续把它们当作合法 public contract。

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

Runtime 分页具体默认值（`K-PAGE-001`）：
- 默认 `page_size` = 50
- 最大 `page_size` = 200
- 超出范围时 runtime 自动 clamp 至 [1, 200] 区间，不报错

## S-RUNTIME-067 鉴权与主体上下文分离

Runtime SDK 必须将“鉴权 token”与“业务主体标识”分离建模：

- `auth.accessToken`：用于 Runtime AuthN（`authorization` 注入）。
- `subjectContext`：用于填充请求体 `subjectUserId`。

两者语义独立，不得复用同一配置字段。

## S-RUNTIME-068 Subject Context 命名规范

RuntimeOptions 公开字段必须使用 `subjectContext` 命名，不得继续暴露 `authContext` 旧命名。

## S-RUNTIME-069 调度器并发拒绝

Runtime 调度器在 per-app 并发上限（2）或全局并发上限（8）达到时返回 `RESOURCE_EXHAUSTED`（`K-DAEMON-007`）。SDK 处理规则：

- `RESOURCE_EXHAUSTED` 属于 S-ERROR-004 定义的 retryable transport code，SDK 应按 S-RUNTIME-045 退避重试基线自动重试。
- 饥饿检测超时（30s）触发的拒绝同样投影为 `RESOURCE_EXHAUSTED`，SDK 行为一致。

## S-RUNTIME-070 Session 恢复协议

SDK 消费者应在 `runtime.disconnected` 事件（`S-RUNTIME-028`）处理器中无条件重新 `connect()` + `OpenSession()`（`K-AUTHSVC-012`）：

- 恢复失败按 S-RUNTIME-045 退避重试基线重试。
- 不区分网络故障和 daemon 重启——两者恢复策略相同（重新建立连接并打开新 session）。
- session 恢复是消费者侧职责，SDK 不自动执行（与 S-TRANSPORT-003 禁止隐式重连一致）。

## S-RUNTIME-071 Connector 字段预校验（建议性）

SDK 可在客户端侧对 Connector 操作执行预校验以改善 DX（`K-RPC-007`/`K-RPC-008`）：

- `CreateConnector`: 请求面只表示 `REMOTE_MANAGED` 创建路径，不接受调用方自定义 `kind`；`api_key` 必填。
- `UpdateConnector`: 至少包含一个可变字段，否则建议在客户端侧提前拒绝。

此规则为建议性（SHOULD），服务端强制校验是权威。客户端预校验旨在减少无效 RPC 往返。

## S-RUNTIME-072 Music Iteration Fail-Fast

SDK 对 `runtime.media.music.iterate()` 必须执行最小 fail-fast 预校验，以减少无效 RPC 往返：

- `mode` 只能是 `extend | remix | reference`
- `sourceAudioBase64` 必须非空且可解码
- `trimStartSec` / `trimEndSec` 必须为非负数
- 同时提供 start/end 时必须 `trimEndSec > trimStartSec`

该预校验不得替代 runtime 权威校验；服务端 reason code 仍是权威事实源。
