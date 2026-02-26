# Runtime 多模态 R5 残差审计（收口后复核）

- 审计日期：2026-02-26
- 范围：`ssot/runtime/*`、`runtime/internal/services/ai/*`、`runtime/internal/services/localruntime/*`
- 基线：`dev/report/runtime-multimodal-r5-2026-02-26.md`

## 1. 结论

R5 主目标（协议完整性 + 媒体 strict fail-close）已达成；截至本次复核，原残差项已全部收敛。当前后续项为 R6 范围扩展，不阻断 R5 结项。

## 2. 已收敛项（本次新增）

1. `DONE` LocalAI adapter 按 capability 分流
   - 变更：`adapterForProviderCapability(provider, capability)`，`localai` 在 `image/video/tts/stt` 返回 `localai_native_adapter`，`chat/embed` 返回 `openai_compat_adapter`。
   - 代码：`runtime/internal/services/localruntime/service.go`
   - 测试：`TestLocalRuntimeNodeCatalogFiltersByCapabilityAndProvider` 增加 `localai image/chat` adapter 断言。
   - 验证：`cd runtime && go test ./internal/services/localruntime` PASS。

2. `DONE` ByteDance OpenSpeech STT WebSocket transport
   - 变更：`executeBytedanceOpenSpeech` 在 STT 路径按 `audio_source.audio_chunks`/`provider_options.transport=ws` 走 WS 传输；保留 HTTP 兼容路径。
   - 代码：`runtime/internal/services/ai/media_job_methods.go`
   - 测试：新增 `TestSubmitMediaJobBytedanceOpenSpeechSTTWS`，断言 start/audio/finish 帧与终态文本。
   - 验证：`cd runtime && go test ./internal/services/ai` PASS，`pnpm check:runtime-ai-media-coverage` PASS。

## 3. 本轮已修正文档一致性问题

1. `ssot/runtime/multimodal-delivery-gates.md`
   - G5 报告引用从 R4 更新为 R5 报告与证据
   - G7 发布命令修正为可执行路径：`cd runtime && go run ./cmd/runtime-compliance --gate`
   - 新增 Gate 状态快照（初版为 G0-G5 PASS，G6/G7 PENDING；后续 I6 已收敛为 G6/G7 PASS）
2. `ssot/runtime/multimodal-provider-contract.md`
   - 修复 frontmatter 双分隔符
   - 增加 R5/R6 scope 切面说明
3. `ssot/runtime/proto-contract.md`
   - 修正 `updated_at` 与变更记录日期，避免未来日期漂移

附：G6/G7 收敛证据见 `dev/report/runtime-multimodal-g6-g7-2026-02-26.md`。

## 4. 复核门禁

1. `pnpm check:ssot-frontmatter`：PASS
2. `pnpm check:ssot-traceability`：PASS
3. `pnpm check:ssot-links`：PASS
4. `cd runtime && go test ./internal/services/localruntime`：PASS
5. `cd runtime && go test ./internal/services/ai`：PASS
6. `pnpm check:runtime-ai-media-coverage`：PASS
