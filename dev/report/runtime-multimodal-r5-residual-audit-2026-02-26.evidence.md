# Runtime 多模态 R5 残差审计证据

- 日期：2026-02-26
- 关联报告：`dev/report/runtime-multimodal-r5-residual-audit-2026-02-26.md`

## 1. SSOT 校验

1. `pnpm check:ssot-frontmatter`：PASS
2. `pnpm check:ssot-traceability`：PASS
3. `pnpm check:ssot-links`：PASS

## 2. 代码证据定位

1. LocalAI adapter 分流实现与断言
   - `runtime/internal/services/localruntime/service.go:490`
   - `runtime/internal/services/localruntime/service.go:834`
   - `runtime/internal/services/localruntime/service_test.go:220`
2. ByteDance OpenSpeech STT WebSocket 实现与断言
   - `runtime/internal/services/ai/media_job_methods.go`（`executeBytedanceOpenSpeechWS`）
   - `runtime/internal/services/ai/media_job_methods_test.go`（`TestSubmitMediaJobBytedanceOpenSpeechSTTWS`）
   - `runtime/internal/services/ai/media_job_methods_test.go`（`TestSubmitMediaJobBytedanceOpenSpeechSTTWSFailedMapsUnavailable`）
   - `runtime/internal/services/ai/media_job_methods_test.go`（`TestSubmitMediaJobBytedanceOpenSpeechSTTWSReadTimeoutMapsProviderTimeout`）
3. 合同要求与范围说明
   - `ssot/runtime/multimodal-provider-contract.md:236`
   - `ssot/runtime/multimodal-provider-contract.md:220`

## 3. 复核命令

1. `cd runtime && go test ./internal/services/localruntime`：PASS
2. `cd runtime && go test ./internal/services/ai`：PASS
3. `pnpm check:runtime-ai-media-coverage`：PASS
