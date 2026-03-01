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

## D-STRM-004 — 取消/中止语义

用户主动取消和系统超时取消：

- **用户取消**：用户点击"停止生成"按钮，调用 SDK abort 机制取消流。已渲染内容保留，消息标记为"已停止"。
- **超时取消**：流总耗时超过 120s（K-STREAM-007 总超时）由 Runtime 侧终止，Desktop 收到终帧后正常处理。
- **取消后状态**：取消不触发错误边界（D-ERR-006），UI 回到就绪态，用户可立即发起新请求。
- **并发保护**：同一聊天同一时刻仅允许一个活跃流。新请求发起前必须确保前一个流已完成或已取消。

## Fact Sources

- Runtime `K-STREAM-001~007` — 流式传输规则
- SDK `S-TRANSPORT-003` — 流式行为边界
- SDK `S-ERROR-004` — 重试语义
