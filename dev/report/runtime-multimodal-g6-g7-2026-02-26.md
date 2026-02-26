# Runtime 多模态 G6+G7 门禁收敛报告

- 报告日期：2026-02-26
- 范围：G6（可观测与可靠性）+ G7（发布候选）
- 结论：`PASS`

## 1. G6（可观测与可靠性）结论

1. provider 健康/审计链路测试通过：
   - `cd runtime && go test ./internal/services/audit ./internal/providerhealth ./internal/httpserver ./cmd/nimi`
2. route/fallback/auto-switch 语义由 runtime-compliance 与 ai/workflow 测试集覆盖，结果通过。
3. timeout/unavailable/reasonCode 映射在 ai 服务测试与 compliance 检查中通过。

## 2. G7（发布候选）结论

执行命令全部通过：

1. `cd runtime && go test ./...`
2. `cd runtime && go run ./cmd/runtime-compliance --gate`（23/23 PASS）
3. `pnpm check:runtime-go-coverage`（66.5%，门槛 >=60）
4. `pnpm check:sdk-coverage`（line 91.32 / branch 71.93 / funcs 93.91）

## 3. 发布候选兼容性声明（当前）

1. 已支持：LocalAI/Nexa/LiteLLM/Alibaba/Bytedance(ARK+OpenSpeech HTTP+STT WS)/Gemini/MiniMax 的既有合同路径。
2. fail-close 保持生效：不支持能力返回 `AI_ROUTE_UNSUPPORTED`，provider 不可用返回 `AI_PROVIDER_UNAVAILABLE`。
3. 仍属后续扩展：Kimi/GLM 专项 adapter（不阻断当前门禁通过）。

## 4. 风险清单与回滚策略

1. 风险：Bytedance WS 上游协议字段变更导致解析失败。
   - 回滚：通过 `provider_options.transport` 切回 HTTP 路径，保留 WS 代码但停用路由。
2. 风险：SDK coverage 门槛回归。
   - 回滚：保留新增 coverage 测试，若临时失败仅允许修测后重跑，不降低门槛。
3. 风险：发布后某 provider 可用性波动。
   - 回滚：路由策略切换到稳定 provider，保持 fail-close，不做 silent downgrade。
