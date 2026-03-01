# Streaming Contract

> Owner Domain: `K-STREAM-*`

## K-STREAM-001 适用 RPC

- `StreamGenerate`
- `SynthesizeSpeechStream`
- `SubscribeMediaJobEvents`（状态事件流）

## K-STREAM-002 阶段边界

`StreamGenerate`/`SynthesizeSpeechStream` 的建流边界固定为：

- 在 AI consume 统一评估顺序 `step 1-9` 全部通过后，stream 才算建立。
- 建流前错误统一走 gRPC error。
- 建流后业务/上游错误优先走终帧事件（`done=true + reason_code`）。

## K-STREAM-003 文本流事件约束

- `done=false` 事件：`text_delta` 必须非空。
- `done=true` 终帧：必须携带 `usage`；若上游缺失 token 统计则填 `-1`。
- `done=true` 终帧可携带最后一段 `text_delta`。

## K-STREAM-004 语音流事件约束

- `done=false` 事件：`audio_chunk` 必须非空。
- `done=true` 成功：`reason_code=REASON_CODE_UNSPECIFIED`，`audio_chunk` 为空。
- `done=true` 失败：`reason_code` 必填，`audio_chunk` 为空。

## K-STREAM-005 状态事件流约束

`SubscribeMediaJobEvents` 不使用 `done=true` 语义；终态事件后 server 正常关闭流（gRPC OK）。

## K-STREAM-006 Chunk framing 规则

流式 AI 输出的 chunk 最小单元为 32 bytes。实现在达到最小单元前缓冲数据；终帧时刷出所有剩余缓冲。

## K-STREAM-007 首包超时独立于总超时

流式 RPC 有两个独立超时：

- **首包超时**：从请求发出到收到第一个非空 chunk 的等待上限（默认 10s，`K-DAEMON-008`）。
- **总超时**：从请求发出到流正常关闭的总耗时上限（默认 120s）。

首包超时触发时，流以 `DEADLINE_EXCEEDED` + `AI_PROVIDER_TIMEOUT` 终止。总超时独立计时，不因收到首包而重置。
