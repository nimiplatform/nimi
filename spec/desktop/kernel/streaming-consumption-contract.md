# Streaming Consumption Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 流式消费契约。定义 renderer 进程如何消费 Runtime 流式输出（文本流、语音流），包括订阅生命周期、渲染缓冲、错误恢复、取消语义。

**跨层引用**：Runtime `K-STREAM-001~007`、SDK `S-TRANSPORT-003`。

## D-STRM-001 — 流式订阅生命周期

流式消费遵循固定生命周期：

```
subscribe → onDelta(chunk)* → onDone | onError → cleanup
```

- **subscribe**：通过 SDK Runtime client 发起流式请求（`StreamGenerate` / `SynthesizeSpeechStream`）。
- **onDelta**：每收到一个非终帧 chunk，追加到渲染缓冲区。对应 Runtime K-STREAM-003 `done=false` 事件。
- **onDone**：收到终帧（`done=true`），提取 `usage` 统计，更新 UI 为完成态。对应 Runtime K-STREAM-003 终帧。
- **onError**：流建立失败或传输中断，进入 D-STRM-003 错误处理。
- **cleanup**：释放订阅资源，清除进度指示器。无论正常完成或异常终止均须执行。

## D-STRM-002 — 渲染端缓冲策略

流式文本渲染策略：

- **增量追加**：每个 `text_delta` chunk 追加到消息气泡，不重新渲染整条消息。
- **进度指示**：流活跃期间显示打字指示器（typing indicator），终帧后移除。
- **最小 chunk 对齐**：Runtime K-STREAM-006 保证 chunk 最小 32 bytes，渲染端无需额外缓冲拼接。
- **首包超时感知**：若 subscribe 后 10s 内未收到首个 chunk（对应 K-STREAM-007 首包超时），UI 应展示超时提示而非无限等待。
- **Usage 展示**：终帧携带的 `usage` 数据（token 统计）可选展示在消息元信息区域。若上游 `usage` 字段值为 `-1`（K-STREAM-003），UI 不展示 token 统计。

## D-STRM-003 — 中途错误处理

流式传输中途错误恢复策略：

- **建流前错误**：SDK 抛出异常，走 D-ERR-005 归一化路径，UI 展示错误消息。
- **建流后中断**：流已建立但传输中断（网络断开、daemon 停止等），行为：
  1. 保留已渲染的部分文本（不清空已展示内容）。
  2. 在消息末尾追加中断标记（如"[流式响应中断]"）。
  3. 提供重试按钮，用户可选择重新发送。
- **终帧错误**：收到 `done=true` + 非零 `reason_code`，提取 reason code 走 D-ERR-007 映射为用户消息。
- **SDK 重连约束**：SDK `S-TRANSPORT-003` 禁止隐式重连续流，Desktop 不得自动重试中断的流。
- **语音流错误码**：`SynthesizeSpeechStream` 中途错误使用通用 provider reason codes（`AI_PROVIDER_UNAVAILABLE`、`AI_PROVIDER_TIMEOUT`、`AI_STREAM_BROKEN` 等），Phase 1 无语音专用错误码。语音流错误走 D-ERR-007 通用投影路径。

## D-STRM-004 — 取消/中止语义

用户主动取消和系统超时取消：

- **用户取消**：用户点击"停止生成"按钮，调用 SDK abort 机制取消流。已渲染内容保留，消息标记为"已停止"。
- **超时取消**：流总耗时超过 120s（K-STREAM-007 总超时，完整超时表见 D-STRM-006 / K-DAEMON-008）由 Runtime 侧终止，Desktop 收到终帧后正常处理。
- **取消后状态**：取消不触发错误边界（D-ERR-006），UI 回到就绪态，用户可立即发起新请求。
- **并发保护**：同一聊天同一时刻仅允许一个活跃流。新请求发起前必须确保前一个流已完成或已取消。

## D-STRM-005 — MediaJob 事件流消费生命周期

MediaJob 事件流（`SubscribeMediaJobEvents`）使用独立于文本/语音流的消费生命周期。引用 Runtime K-JOB-002 终态集合和 K-STREAM-005 流关闭语义。

**生命周期**：

```
subscribe → onJobEvent* → onTerminalState(gRPC OK close) → cleanup
```

- **subscribe**：通过 SDK Runtime client 发起 `SubscribeMediaJobEvents(job_id)` 订阅。
- **onJobEvent**：每收到一个 job 状态事件（`PENDING` → `RUNNING` → ...），更新 UI 进度（进度条、状态文本）。
- **onTerminalState**：收到终态事件（K-JOB-002: `COMPLETED` / `FAILED` / `CANCELLED` / `EXPIRED`）后，server 正常关闭流（gRPC OK）。**注意**：此流不使用 `done=true` 终帧语义（K-STREAM-005），与 D-STRM-001 的 `onDone(done=true)` 生命周期根本不同。
- **cleanup**：释放订阅资源，移除进度指示器。

**终态 UI 映射**：

| 终态 | UI 行为 |
|---|---|
| `COMPLETED` | 展示生成结果（图片/视频/音频），隐藏进度条 |
| `FAILED` | 展示错误消息（reason code 走 D-ERR-007），提供重试按钮 |
| `CANCELLED` | 展示"已取消"状态，保留操作历史 |
| `EXPIRED` | 展示"任务已过期"提示，建议用户重新提交 |

**与文本流的差异**：

- 文本流（D-STRM-001）：增量 chunk 追加渲染，`done=true` 终帧。
- MediaJob 流（D-STRM-005）：离散状态事件，gRPC OK 关闭。不支持增量渲染，结果在终态后通过 `GetMediaResult` 获取。

**跨层引用**：Runtime K-JOB-001~006、K-STREAM-005。

## D-STRM-007 — Mode C (eof=true) 消费规则

Mode C 流（`ExportAuditEvents`，`K-STREAM-009`）使用 `eof=true` 标记最后一个数据块，server 随后 gRPC OK close。

**Phase 1 声明**：`ExportAuditEvents` 属于 Phase 2 服务（`audit_service_projection`）。Desktop Phase 1 不消费 Mode C 流。当 Phase 2 激活时，需在本节补充完整消费规则。

**跨层引用**：Runtime `K-STREAM-008`（模式 C）、`K-STREAM-009`（eof 协议）。

## D-STRM-008 — Mode D（长生命周期订阅流）消费规则

Mode D 流（`K-STREAM-010`）没有业务层终止信号，流生命周期与 daemon/资源绑定。适用 RPC：`SubscribeRuntimeHealthEvents`、`SubscribeAIProviderHealthEvents`、`SubscribeAppMessages`。

**Desktop 消费路径**：Desktop Phase 1 **不通过 SDK Mode D 流路径**消费健康事件。等价数据通过以下 IPC 桥路径获取：

- **Runtime 健康状态**：`D-IPC-002`（`runtime_bridge_status` 轮询）提供 runtime 连接状态。
- **本地 LLM 健康**：`D-LLM-004`（`checkLocalLlmHealth`）提供即时健康检查。
- **Provider 健康**：通过 `ConnectorService.TestConnector` unary RPC 按需探测，非持续订阅。

**等价关系声明**：SDK `S-TRANSPORT-007` 将 `SubscribeRuntimeHealthEvents` / `SubscribeAIProviderHealthEvents` 归入 `health_monitoring_projection`，声明 Desktop 通过 IPC 桥消费等价数据。本规则正式确认该等价关系：Desktop 使用 IPC 桥（轮询 + 按需探测）替代 Mode D 持续订阅流，两条路径提供语义等价的健康状态信息。

**`SubscribeAppMessages` 排除**：属于 Phase 2 服务（`app_service_projection`），Desktop Phase 1 不消费。

**Mode D 流关闭处理**（仅适用于未来直接消费 Mode D 流的场景）：

- Server 以 gRPC `CANCELLED` 关闭流（daemon STOPPING 或资源不可用）。
- 收到 `CANCELLED` 后不触发错误边界（`D-ERR-006`），视为正常断开。
- 重建策略由 Desktop 消费层决定（可选自动重订阅或等待 `runtime.connected` 事件后重订阅）。
- 遵循 SDK `S-ERROR-012`（Mode D CANCELLED 语义）和 `S-TRANSPORT-003`（禁止隐式重连）。

**跨层引用**：Runtime `K-STREAM-008`（模式 D）、`K-STREAM-010`（长生命周期订阅协议）、SDK `S-TRANSPORT-007`（Mode D 投影）、SDK `S-ERROR-012`（CANCELLED 语义）。

## D-STRM-006 — AI 操作超时感知表

Desktop 必须为每种 AI 操作设置正确的 UI 超时行为。超时值引用 Runtime K-DAEMON-008 AI 超时层次。

| AI 操作 | Runtime 默认超时 | UI 超时行为 |
|---|---|---|
| `Generate`（unary） | 30s | loading indicator 最长 30s，超时展示"AI 响应超时" |
| `StreamGenerate`（首包） | 10s | 首包 10s 内无响应，展示"等待响应中…"警告 |
| `StreamGenerate`（总） | 120s | 总超时 120s，由 Runtime 终止流，正常处理终帧 |
| `Embed` | 20s | loading indicator 最长 20s，超时展示"嵌入操作超时" |
| `SynthesizeSpeechStream` | 45s | 语音播放器 loading 最长 45s |
| `SubmitMediaJob`(image) | 120s | 图片生成进度条最长 120s，期间展示预估剩余时间 |
| `SubmitMediaJob`(video) | 300s | 视频生成进度条最长 300s，期间展示预估剩余时间 |
| `SubmitMediaJob`(stt) | 90s | 语音转文字 loading 最长 90s |

**超时处理规则**：

- Runtime 侧超时（K-DAEMON-008）返回 `DEADLINE_EXCEEDED` + `AI_PROVIDER_TIMEOUT`，走 D-ERR-007 映射。
- Desktop UI 超时指示器基于上表设置，与 Runtime 超时值保持一致。
- 用户可在超时前主动取消（走 D-STRM-004 取消语义）。

**跨层引用**：Runtime K-DAEMON-008。

## Fact Sources

- Runtime `K-STREAM-001~007` — 流式传输规则
- Runtime `K-STREAM-008` — 流关闭模式统一分类（Mode A/B/C/D）
- Runtime `K-STREAM-009` — eof 标记流关闭协议（Mode C）
- Runtime `K-STREAM-010` — 长生命周期订阅流协议（Mode D）
- Runtime `K-JOB-001~006` — MediaJob 生命周期
- Runtime `K-STREAM-005` — MediaJob 事件流关闭语义
- Runtime `K-DAEMON-008` — AI 操作超时层次
- SDK `S-TRANSPORT-003` — 流式行为边界
- SDK `S-TRANSPORT-007` — 流式终帧投影（含 Mode D 投影规则）
- SDK `S-ERROR-004` — 重试语义
- SDK `S-ERROR-012` — Mode D 流 CANCELLED 语义
