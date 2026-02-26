# Runtime 多模态 R5 残差审计（收口后复核）

- 审计日期：2026-02-26
- 范围：`ssot/runtime/*`、`runtime/internal/services/ai/*`、`runtime/internal/services/localruntime/*`
- 基线：`dev/report/runtime-multimodal-r5-2026-02-26.md`

## 1. 结论

R5 主目标（协议完整性 + 媒体 strict fail-close）已达成；截至本次复核，原残差项已收敛 1 项，仍有 1 项进入 R6 跟踪。

## 2. 发现（按优先级）

1. `MEDIUM` ByteDance OpenSpeech 目前仅 HTTP 适配，WS 专线仍未落地
   - 现状：`executeBytedanceOpenSpeech` 仅调用 HTTP JSON/Binary endpoint，未引入 WS transport。
   - 证据：`runtime/internal/services/ai/media_job_methods.go:929`（函数实现）
   - 影响：流式语音与长会话场景的协议兼容度仍受限。
   - 建议：按 R6 范围新增 WS adapter 与合同测试，覆盖断线重连、分片顺序与终态一致性。

## 3. 已收敛项（本次新增）

1. `DONE` LocalAI adapter 按 capability 分流
   - 变更：`adapterForProviderCapability(provider, capability)`，`localai` 在 `image/video/tts/stt` 返回 `localai_native_adapter`，`chat/embed` 返回 `openai_compat_adapter`。
   - 代码：`runtime/internal/services/localruntime/service.go`
   - 测试：`TestLocalRuntimeNodeCatalogFiltersByCapabilityAndProvider` 增加 `localai image/chat` adapter 断言。
   - 验证：`cd runtime && go test ./internal/services/localruntime` PASS。

## 4. 本轮已修正文档一致性问题

1. `ssot/runtime/multimodal-delivery-gates.md`
   - G5 报告引用从 R4 更新为 R5 报告与证据
   - G7 发布命令修正为可执行路径：`cd runtime && go run ./cmd/runtime-compliance --gate`
   - 新增 Gate 状态快照（G0-G5 PASS，G6/G7 PENDING）
2. `ssot/runtime/multimodal-provider-contract.md`
   - 修复 frontmatter 双分隔符
   - 增加 R5/R6 scope 切面说明
3. `ssot/runtime/proto-contract.md`
   - 修正 `updated_at` 与变更记录日期，避免未来日期漂移

## 5. 复核门禁

1. `pnpm check:ssot-frontmatter`：PASS
2. `pnpm check:ssot-traceability`：PASS
3. `pnpm check:ssot-links`：PASS
4. `cd runtime && go test ./internal/services/localruntime`：PASS
