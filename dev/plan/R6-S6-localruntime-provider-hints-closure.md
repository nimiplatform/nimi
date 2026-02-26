# R6-S6 Localruntime Provider Hints 闭环计划

- 日期：2026-02-26
- 状态：DONE
- 关联审计：`dev/report/runtime-multimodal-r5-residual-audit-2026-02-26.md`

## 1. 目标

1. 补齐 `ListNodeCatalog` 返回节点中的 `provider_hints` 字段。
2. 对 `nexa` 节点填充 NPU 相关 gate 字段（`host_npu_ready`、`policy_gate_allows_npu`、`npu_usable` 等）。
3. 新增测试，确保 `localai/nexa` 节点 hints 与 fail-close 语义一致。

## 2. 执行步骤

1. 在 `runtime/internal/services/localruntime/service.go` 新增 `buildNodeProviderHints` 并在 `ListNodeCatalog` 中接入。
2. `localai` 节点：填充 `backend/preferred_adapter` 与能力提示字段。
3. `nexa` 节点：填充 `npu_mode/policy_gate/host_npu_ready/model_probe_has_npu_candidate/policy_gate_allows_npu/npu_usable/gate_reason/gate_detail`。
4. 更新 `runtime/internal/services/localruntime/service_test.go`：
   - `TestLocalRuntimeNodeCatalogFiltersByCapabilityAndProvider`
   - `TestLocalRuntimeNodeCatalogNexaVideoFailClose`
5. 复跑 gate 命令并同步审计与 SSOT 迭代表。

## 3. 验收命令

1. `cd runtime && go test ./internal/services/localruntime ./internal/services/ai -count=1`
2. `pnpm check:runtime-ai-media-coverage`
3. `cd runtime && go run ./cmd/runtime-compliance --gate`
4. `pnpm check:ssot-frontmatter && pnpm check:ssot-links && pnpm check:ssot-traceability`

## 4. 完成判定

1. 节点返回不再缺失 `provider_hints`。
2. `nexa video` 保持 fail-close，且 hints 中 NPU/policy 字段与节点状态一致。
3. 所有验收命令全绿。
