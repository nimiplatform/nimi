# R5 Runtime 多模态协议完整性收敛计划（Strict Fail-Close）

## 摘要
1. 目标：优先完成 research 报告中的协议表达与消费闭环（P0-1、P1-1、P1-2、P1-3、P2-1），并立即切换严格 fail-close。
2. 交付标准：proto、SDK、runtime、workflow 同轮闭环；新增语义均有自动化测试与 CI 证据。
3. 非目标：Kimi/GLM 专项 adapter、ByteDance WS 流式语音专线，延后到 R6。

## 公开接口与类型变更
1. 在 [ai.proto](/Users/snwozy/nimi-realm/nimi/proto/runtime/v1/ai.proto) 扩展 canonical 字段：`ImageGenerationSpec` 增加 `reference_images`、`mask`、`response_format`；`SpeechSynthesisSpec` 增加 `emotion`；`SpeechTranscriptionSpec` 增加 `response_format` 与 `audio_source(oneof: audio_bytes|audio_uri|audio_chunks)`。
2. 在 [ai.proto](/Users/snwozy/nimi-realm/nimi/proto/runtime/v1/ai.proto) 的 `SubmitMediaJobRequest` 增加 `request_id`、`idempotency_key`、`labels`。
3. 在 [ai.proto](/Users/snwozy/nimi-realm/nimi/proto/runtime/v1/ai.proto) 给旧媒体 RPC（`GenerateImage/GenerateVideo/SynthesizeSpeech/TranscribeAudio`）添加 deprecated 注释，保留兼容窗口不删除。
4. 在 [workflow.proto](/Users/snwozy/nimi-realm/nimi/proto/runtime/v1/workflow.proto) 的 `WorkflowNode` 增加 `resume_strategy`、`callback_ref`；保留现有 `execution_mode` 与 `NODE_EXTERNAL_*` 事件。
5. 在 [model.proto](/Users/snwozy/nimi-realm/nimi/proto/runtime/v1/model.proto) 新增 `ModelCapabilityProfile`，并在 `ModelDescriptor` 增加 `capability_profile`；`repeated string capabilities` 保留兼容。

## Runtime 实现方案
1. 在 [media_job_methods.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/media_job_methods.go) 让四类模态主路径完整消费 canonical 字段，不再只消费 `prompt/text/audio_bytes`。
2. 在 [media_job_methods.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/media_job_methods.go) 增加强校验：`n`、`duration_sec`、`fps`、`sample_rate_hz`、`speaker_count` 等范围校验；非法值返回 `AI_INPUT_INVALID`。
3. 在 [provider_cloud.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/provider_cloud.go) 和 [provider_local.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/provider_local.go) 移除“合成成功回退”路径；后端不可用统一 `Unavailable + AI_PROVIDER_UNAVAILABLE`。
4. 在 [media_job_methods.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/media_job_methods.go) 完整填充 `MediaArtifact` 元数据（`uri/mime/sha256/size/duration/fps/width/height/sample_rate/channels/provider_raw`），不依赖固定 mime。
5. 在 [media_job_methods.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/media_job_methods.go) 落地 `idempotency_key` 去重（作用域：`app_id + subject_user_id + model_id + modal + spec-hash`），命中时返回同 `job_id`。
6. 在 [media_job_methods.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/ai/media_job_methods.go) 对 gemini/minimax 轮询持续更新 `next_poll_at`、`retry_count`、`provider_job_id`。

## Workflow external-async 收敛
1. 在 [executor.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/workflow/executor.go) 增加取消透传：节点已 `SubmitMediaJob` 后若 workflow 取消或超时，必须调用 `CancelMediaJob`。
2. 在 [executor.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/workflow/executor.go) 固化 `NODE_EXTERNAL_*` 事件 payload 字段：`job_id`、`provider_job_id`、`status`、`retry_count`、`reason_code`、`reason_detail`。
3. 在 [state.go](/Users/snwozy/nimi-realm/nimi/runtime/internal/services/workflow/state.go) 保持 `provider_job_id`、`next_poll_at`、`retry_count`、`last_error` 与任务轮询一致更新。

## SDK 收敛方案
1. 在 [index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/ai-provider/index.ts) 扩展映射：新增 canonical 字段和 `requestId/idempotencyKey/labels` 透传到 `SubmitMediaJob`。
2. 在 [index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/ai-provider/index.ts) 调整取消语义：`AbortSignal` 触发时先调用 `cancelMediaJob`，再抛出 SDK 错误。
3. 在 [index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/ai-provider/index.ts) 和生成类型中补 `@deprecated` 标注，维持旧签名兼容。

## 测试与门禁
1. Provider fail-close：把 fallback-success 断言改为 `Unavailable/AI_PROVIDER_UNAVAILABLE`，覆盖 local/cloud 两路。
2. Canonical 映射：为 image/video/tts/stt 增加 request-body 断言，确认字段和 `provider_options` 被消费。
3. 校验边界：新增非法范围与缺失字段测试，必须返回稳定 reasonCode。
4. Artifact metadata：新增元数据字段断言测试，不允许空壳 artifact。
5. Idempotency：新增重复提交同 key 返回同 job 的测试。
6. Workflow cancel 透传：新增 external-async 取消路径测试，断言调用 `CancelMediaJob` 且事件完整。
7. 执行命令：`cd proto && buf lint`；`cd proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb`；`cd proto && buf generate`；`cd runtime && go test ./internal/services/ai ./internal/services/workflow ./internal/services/localruntime ./internal/daemon ./internal/httpserver`；`pnpm check:runtime-go-coverage`；`pnpm check:runtime-ai-media-coverage`；`cd runtime && go run ./cmd/runtime-compliance --gate`。

## 交付切片（提交顺序）
1. Slice A：proto + generated + ssot（只改合同与类型，不改行为）。
2. Slice B：runtime 行为收敛（strict fail-close、canonical 消费、artifact metadata、workflow cancel 透传）。
3. Slice C：sdk 映射 + 测试矩阵更新 + CI 证据文档更新。

## 假设与默认值
1. 已确认本轮优先级为“协议完整性先行”。
2. 已确认本轮允许直接切换严格 fail-close。
3. 默认旧 RPC 保留兼容窗口，不在本轮删除。
4. 默认 Kimi/GLM 与 ByteDance WS 适配延后到 R6，不阻断 R5 完成。
