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

Socket.IO WebSocket 传输层：

- `resolveRealtimeUrl()`：从 `realmBaseUrl` / `realtimeUrl` 解析 WebSocket 连接地址。本地环境 3002 端口自动映射为 3003。
- 传输固定为 `['websocket']`，路径 `/socket.io/`。
- 认证：通过 `auth.token` 在握手时传递 Bearer Token。
- 连接生命周期：`connect` 事件触发 session 恢复和 outbox 刷新。
- 会话管理：`chat:session.open` / `chat:session.ready` / `chat:event.ack` 协议。
- 事件去重：客户端维护 `seenEvents` LRU 映射（上限 3000 条）防止重复处理。达到上限时按 LRU 策略驱逐最久未访问的条目，确保内存占用可控。
- 断线恢复：`chat:session.sync_required` 触发增量同步回填。

## Fact Sources

- `tables/retry-status-codes.yaml` — 可重试 HTTP 状态码
