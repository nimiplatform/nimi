# Runtime 多模态 R5 收敛报告（协议完整性优先）

- 报告日期：2026-02-26
- 对齐计划：`R5 Runtime 多模态协议完整性收敛计划（Strict Fail-Close）`
- 结论：`PASS`（Slice A/B/C 已闭环，关键门禁通过）

## 1. 交付范围完成度

1. Slice A（proto + generated + ssot）：PASS
   - `ai.proto`：补齐 image/tts/stt canonical 字段、`SubmitMediaJob` 元数据字段、旧媒体 RPC `deprecated`
   - `workflow.proto`：新增 `resume_strategy`、`callback_ref`
   - `model.proto`：新增 `ModelCapabilityProfile` + `ModelDescriptor.capability_profile`
   - 生成产物同步：runtime/sdk generated files
2. Slice B（runtime + workflow 行为收敛）：PASS
   - strict fail-close：cloud/local media 路径不再 synthetic success fallback
   - canonical 消费：media 主路径消费并透传 canonical 字段（含 provider_options）
   - 输入校验：`n/duration_sec/fps/sample_rate_hz/speaker_count` 范围校验 -> `AI_INPUT_INVALID`
   - artifact metadata：补齐 `mime/sha256/size/uri/duration/fps/width/height/sample_rate/channels/provider_raw`
   - idempotency：`app_id + subject_user_id + model_id + modal + idempotency_key + spec-hash` 命中返回同 `job_id`
   - gemini/minimax 轮询状态写回：`provider_job_id/next_poll_at/retry_count`
   - workflow external-async：取消透传 `CancelMediaJob`，`NODE_EXTERNAL_*` payload 字段统一
3. Slice C（sdk + tests + evidence）：PASS
   - SDK：新增 canonical 字段映射、`requestId/idempotencyKey/labels` 透传
   - SDK 取消语义：`AbortSignal` 触发先调用 `cancelMediaJob` 再抛 SDK 错误
   - 测试：新增/更新 runtime + workflow + sdk 断言
   - 证据：见 `runtime-multimodal-r5-2026-02-26.evidence.md`

## 2. 关键新增/更新测试点

1. Runtime AI
   - `TestSubmitMediaJobIdempotencyReturnsSameJob`
   - `TestSubmitMediaJobRangeValidation`
   - `TestSubmitMediaJobGeminiOperation`（canonical/provier_options request body 断言）
2. Workflow
   - `TestWorkflowExternalAsyncCancelPropagatesToMediaJob`
   - `TestWorkflowExternalAsyncMediaNode`（`NODE_EXTERNAL_*` payload 必含字段断言）
3. SDK
   - `createNimiAiProvider abort signal cancels media job before throwing`
   - `createNimiAiProvider forwards requestId/idempotencyKey/labels to submitMediaJob`

## 3. 当前门禁结果

1. `buf lint / breaking / generate`：PASS
2. `go test ./...`（runtime）：PASS
3. `pnpm check:runtime-go-coverage`：PASS（66.1%）
4. `pnpm check:runtime-ai-media-coverage`：PASS（ai 71.5%，media-core 全部 >=80%）
5. `go run ./cmd/runtime-compliance --gate`：PASS（23/23）
6. `pnpm --filter @nimiplatform/sdk test`：PASS（42/42）

## 4. R5 非目标状态

1. Kimi/GLM 专项 adapter：未纳入本轮
2. ByteDance WS 流式语音专线：未纳入本轮

