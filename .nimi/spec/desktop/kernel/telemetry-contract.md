# Telemetry Contract

> Authority: Desktop Kernel

## Scope

Desktop 遥测日志契约。定义结构化日志格式、日志级别、区域枚举、流 ID 追踪、消息格式约定。

## D-TEL-001 — 日志载荷结构

`RuntimeLogPayload`：

```typescript
{
  level?: 'debug' | 'info' | 'warn' | 'error';
  area: string;          // 日志区域（参考 tables/log-areas.yaml）
  message: string;       // 格式化消息
  traceId?: string;      // 会话追踪 ID
  flowId?: string;       // 流程追踪 ID
  source?: string;       // 来源标识
  costMs?: number;       // 耗时（毫秒）
  details?: Record<string, unknown>;  // 附加详情
}
```

## D-TEL-002 — 消息格式约定

消息必须符合两种前缀之一：

- `action:<name>` — 动作类日志（如 `action:invoke-start:http_request`）
- `phase:<name>` — 阶段类日志（如 `phase:bootstrap:done`）

归一化：`normalizeRuntimeLogMessage` 自动添加 `action:` 前缀。

## D-TEL-003 — Logger 注入

`setRuntimeLogger(logger)` 注入运行时 logger：

- 非空时：日志转发到注入的 logger 函数。
- 为空时：回退到 `console.*`（`fallbackConsoleLog`）。
- 启动序列中在 `bootstrapRuntime()` 入口处注入（早于 `D-BOOT-001`），通过 `desktopBridge.logRendererEvent` 转发到 Tauri backend。

## D-TEL-004 — 流程追踪 ID

`createRendererFlowId(prefix)` 生成唯一流程 ID：

- 格式：`${prefix}-${timestamp}-${random}`
- 用途：关联同一流程的多条日志（如 bootstrap 流程）。

## D-TEL-005 — Bridge 调用追踪

每次 `invoke()` 调用生成追踪信息：

- `invokeId`：`${command}-${timestamp}-${random}`（格式由 `D-IPC-009` 定义）
- `sessionTraceId`：renderer 会话级追踪 ID。
- 日志事件：`invoke-start`（info）、`invoke-success`（debug）、`invoke-failed`（error）。

## D-TEL-006 — Renderer 日志转发

Renderer 日志通过 IPC 转发到 Tauri backend：

- `RendererLogPayload` 与 `RuntimeLogPayload` 结构对齐。
- `toRendererLogMessage()` 确保消息格式正确。

## D-TEL-007 — 网络层日志区域

`net` 日志区域用于网络重试事件和错误归一化日志：

- 重试事件：`action:retry:retrying`、`action:retry:recovered`、`action:retry:retry_exhausted`。
- 日志级别：retrying=warn、recovered=info、exhausted=error。
- 来源：`request-with-retry.ts` 中的 `requestWithRetry` 函数。

## D-TEL-008 — 全局 trace_id 传播

所有 bridge 错误对象和日志条目在 upstream 提供 `trace_id` 时必须保留并传播，不限于 LLM 路径。

**覆盖范围**：

- **LLM 路径**：D-LLM-008 已覆盖（text/image/video/stt/embedding/speech）。
- **DataSync 错误**：D-DSYNC-000 `emitDataSyncError` 产生的错误对象，若 upstream 响应包含 `trace_id`，必须保留。
- **Auth 错误**：D-AUTH-006/007 token 刷新失败时，若 upstream 返回 `trace_id`，错误对象必须携带。
- **Mod 治理错误**：D-MOD-003 capability 检查失败、D-MOD-009 审计写入失败时，若上游提供 `trace_id`，必须传播到错误日志。
- **Bridge invoke 错误**：D-ERR-011 已要求 `traceId` 为必输出字段，本规则确认此要求覆盖所有 bridge 路径。

**传播规则**：

- upstream 提供 `trace_id` 时：错误对象 `traceId` 字段 = upstream 值。
- upstream 未提供 `trace_id` 时：不强制生成（仅 D-LLM-008 规定的 LLM 路径需生成 fallback trace）。

**跨层引用**：K-AUDIT-019（trace_id 全层级保留）、K-AUDIT-020（trace_id 传播要求）。

## Fact Sources

- `tables/log-areas.yaml` — 日志区域枚举
