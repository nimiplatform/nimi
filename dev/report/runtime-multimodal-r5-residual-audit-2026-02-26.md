# Runtime 多模态 R5 残差审计（收口后复核）

- 审计日期：2026-02-26
- 范围：`ssot/runtime/*`、`runtime/internal/services/ai/*`、`runtime/internal/services/localruntime/*`
- 基线：`dev/report/runtime-multimodal-r5-2026-02-26.md`

## 1. 结论

R5 主目标（协议完整性 + 媒体 strict fail-close）已达成，但仍有 2 个进入 R6 的收敛项需要跟踪。

## 2. 发现（按优先级）

1. `MEDIUM` LocalAI media adapter 语义与合同仍有偏差
   - 现状：`ListNodeCatalog` 的 adapter 选择按 provider 粗粒度决策，除 `nexa` 外均返回 `openai_compat_adapter`。
   - 证据：`runtime/internal/services/localruntime/service.go:490`、`runtime/internal/services/localruntime/service.go:834`
   - 合同基线：`ssot/runtime/multimodal-provider-contract.md:236` 要求 `stt/tts/image/video` 默认 `localai_native_adapter`。
   - 影响：节点目录与审计语义不能准确区分 LocalAI media native 路径。
   - 建议：R6 改为 `adapterForProviderCapability(provider, capability)`，并补 `localai image/video/tts/stt` 与 `chat/embed` 分流测试。

2. `MEDIUM` ByteDance OpenSpeech 目前仅 HTTP 适配，WS 专线仍未落地
   - 现状：`executeBytedanceOpenSpeech` 仅调用 HTTP JSON/Binary endpoint，未引入 WS transport。
   - 证据：`runtime/internal/services/ai/media_job_methods.go:929`（函数实现）
   - 影响：流式语音与长会话场景的协议兼容度仍受限。
   - 建议：按 R6 范围新增 WS adapter 与合同测试，覆盖断线重连、分片顺序与终态一致性。

## 3. 本轮已修正文档一致性问题

1. `ssot/runtime/multimodal-delivery-gates.md`
   - G5 报告引用从 R4 更新为 R5 报告与证据
   - G7 发布命令修正为可执行路径：`cd runtime && go run ./cmd/runtime-compliance --gate`
   - 新增 Gate 状态快照（G0-G5 PASS，G6/G7 PENDING）
2. `ssot/runtime/multimodal-provider-contract.md`
   - 修复 frontmatter 双分隔符
   - 增加 R5/R6 scope 切面说明
3. `ssot/runtime/proto-contract.md`
   - 修正 `updated_at` 与变更记录日期，避免未来日期漂移

## 4. 复核门禁

1. `pnpm check:ssot-frontmatter`：PASS
2. `pnpm check:ssot-traceability`：PASS
3. `pnpm check:ssot-links`：PASS
