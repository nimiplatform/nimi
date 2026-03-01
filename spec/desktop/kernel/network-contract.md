# Network Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 网络层契约。定义代理 fetch 机制、请求重试策略、指数退避算法、可重试状态码、实时 WebSocket 传输。

## D-NET-001 — 可重试状态码

以下 HTTP 状态码触发自动重试（参考 `tables/retry-status-codes.yaml`）：

- `408` Request Timeout
- `425` Too Early
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout

## D-NET-002 — 重试策略

`requestWithRetry` 实现指数退避重试：

默认参数：
- `maxAttempts: 3`
- `initialDelayMs: 120`
- `maxDelayMs: 900`

退避算法：`delayMs = min(maxDelayMs, initialDelayMs * 2^(attempt-1) + uniform_jitter[0, initialDelayMs/2])`

重试条件：
- **状态码重试**：`RETRYABLE_STATUS_CODES.has(error.status)` — `RetryReasonKind: 'status'`
- **网络错误重试**：`AbortError` 或 `TypeError` — `RetryReasonKind: 'network'`

**跨传输重试参数差异说明**：Desktop HTTP 重试参数（120ms initial / 900ms cap）与 SDK Runtime gRPC 重试参数（SDKR-045: 200ms initial / 3000ms cap）不同。此差异是设计意图：

**参数选取依据**（同 K-DAEMON-006/007 注释模式）：
- HTTP（Realm API）初始退避 120ms：Realm REST API 平均响应 <50ms，120ms 足以覆盖瞬时抖动且不引入用户可感知延迟。Cap 900ms：3 次重试总等待 ≈120+240+480≈840ms（含 jitter <1.2s），用户体验上限约 1s。
- gRPC（Runtime）初始退避 200ms：AI 推理 RPC 本身延迟高（首包 1-10s），200ms 退避在推理超时上下文中忽略不计。Cap 3000ms：推理场景更可能因 provider 过载导致暂时不可用，更大退避区间降低 thundering herd 风险。

## D-NET-003 — 重试事件

`RetryEvent` 通过 `onRetryEvent` 回调通知：

- `retrying`：开始重试，包含 delayMs、reasonKind、status。
- `recovered`：重试后恢复，包含 retryCount。
- `retry_exhausted`：重试耗尽，最终失败。

## D-NET-004 — 代理 Fetch

`createProxyFetch()` 创建通过 Tauri backend 代理的 fetch 实现：

- 所有 HTTP 请求通过 `http_request` IPC 命令（`D-IPC-004`）转发。
- 绕过浏览器 CORS 限制。
- Desktop 模式的 DataSync 和 LLM 请求均使用此 fetch。

## D-NET-005 — 错误归一化

`normalizeApiError(error, fallbackMessage?)` 统一错误格式：

- API 错误：保留 status、message。
- 网络错误：转为统一 Error 对象。
- fallbackMessage：无法解析时的兜底消息。

## D-NET-006 — Realtime Transport

**SDK 契约引用**：SDK SDKREALM-035/036/037 定义 Realm 实时传输的 SDK 层约束（token 注入、事件不丢失保证）。D-NET-006 是 Desktop 层的具体实现，满足 SDK 层约束。

Socket.IO WebSocket 传输层：

- `resolveRealtimeUrl()`：从 `realmBaseUrl` / `realtimeUrl` 解析 WebSocket 连接地址。本地环境 3002 端口自动映射为 3003。
- 传输固定为 `['websocket']`，路径 `/socket.io/`。
- 认证：通过 `auth.token` 在握手时传递 Bearer Token。
- 连接生命周期：`connect` 事件触发 session 恢复和 outbox 刷新。
- 会话管理：`chat:session.open` / `chat:session.ready` / `chat:event.ack` 协议。
- 事件去重：客户端维护 `seenEvents` LRU 映射（上限 3000 条）防止重复处理。达到上限时按 LRU 策略驱逐最久未访问的条目，确保内存占用可控。
- 断线恢复：`chat:session.sync_required` 触发增量同步回填。

## D-NET-007 — 轮询与实时传输协同

D-DSYNC-003 的 `syncChatEvents` 轮询与 D-NET-006 的 Socket.IO 实时传输操作同一数据域（聊天消息）。两个通道的协同规则：

**主/辅通道关系**：

- **实时连接活跃时**：Socket.IO 为主通道，chat 轮询（`syncChatEvents`）停止。实时事件通过 `chat:event.*` 协议实时推送，无需轮询补偿。
- **实时连接断开时**：轮询恢复为主通道。断连触发 `chat:session.sync_required` 增量同步回填（D-NET-006），同时恢复 `syncChatEvents` 周期轮询。
- **通道切换时机**：Socket.IO `connect` 事件触发停止 chat 轮询；`disconnect` 事件触发恢复 chat 轮询。

**跨通道消息去重**：

- 通道切换瞬间可能产生重叠（轮询结果和实时事件同时到达）。
- 去重机制统一使用 D-NET-006 的 `seenEvents` LRU 映射（上限 3000 条）。轮询结果和实时事件共享同一 LRU 实例。
- 去重键：消息/事件的唯一 ID。已在 `seenEvents` 中存在的事件静默丢弃。

**通知轮询不受影响**：D-DSYNC-009 的 `loadNotificationUnreadCount` 轮询独立于实时连接状态，始终按固定间隔执行。

**跨层引用**：D-DSYNC-003（chat 轮询）、D-DSYNC-009（通知轮询）、D-NET-006（实时传输）。

## Fact Sources

- `tables/retry-status-codes.yaml` — 可重试 HTTP 状态码
