# Multimodal Delivery Gates Domain Spec

> Scope: 多模态交付治理导引（门禁语义与证据归档位置）。
> Normative Imports: `.nimi/spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/delivery-gates-contract.md`（K-GATE-001, K-GATE-010, K-GATE-020, K-GATE-030, K-GATE-040, K-GATE-050, K-GATE-060, K-GATE-070, K-GATE-080, K-GATE-090）
- `kernel/multimodal-provider-contract.md`（K-MMPROV-011, K-MMPROV-012, K-MMPROV-030~037）
- `kernel/model-catalog-contract.md`（K-MCAT-005, K-MCAT-018, K-MCAT-022, K-MCAT-024, K-MCAT-027）
- `kernel/provider-health-contract.md`（K-PROV-005）
- `kernel/proto-governance-contract.md`（K-PROTO-007, K-PROTO-010）
- `kernel/tables/capability-vocabulary-mapping.yaml`
- `kernel/tables/runtime-delivery-gates.yaml`

## 1. 文档定位

本文件不承载门禁条款正文，只定义阅读路径与证据归档边界。

## 2. 门禁入口

- G0 SSOT Freeze：`pnpm check:ai-scenario-hardcut-drift`、`pnpm check:runtime-spec-kernel-consistency`、`pnpm check:runtime-spec-kernel-docs-drift`。
- G1 Proto Chain：`pnpm proto:lint`、`pnpm proto:generate`、`pnpm proto:breaking`、`pnpm proto:drift-check`、`pnpm check:runtime-proto-spec-linkage`。
- G2 SDK Alignment：`pnpm check:sdk-spec-kernel-consistency`、`pnpm check:sdk-spec-kernel-docs-drift`、`pnpm check:runtime-bridge-method-drift`、`pnpm check:runtime-mod-hook-hardcut`。
- G3 Provider/Coverage：详见 `kernel/delivery-gates-contract.md`（K-GATE-040）。
- G4 Workflow Async：`cd runtime && go test ./internal/services/ai/ -run Test.*ScenarioJob -count=1`。
- G5 Matrix：`node scripts/run-live-test-matrix.mjs`。
- G6 Observability：`cd runtime && go run ./cmd/runtime-compliance --gate`。
- G7 Release Candidate：`pnpm check:live-smoke-gate --require-release`。

## 3. 实施材料位置

- 门定义：`kernel/delivery-gates-contract.md` + `runtime-delivery-gates.yaml`。
- catalog/provider hard-cut 语义锚点：`kernel/model-catalog-contract.md`（K-MCAT-005, K-MCAT-018, K-MCAT-022, K-MCAT-024, K-MCAT-027）与 `kernel/provider-health-contract.md`（K-PROV-005）。
- local category / manifest token → canonical capability 映射：`kernel/tables/capability-vocabulary-mapping.yaml`（K-LOCAL-026, K-MCAT-024）。
- proto linkage 语义锚点：`kernel/proto-governance-contract.md`（K-PROTO-007, K-PROTO-010）。
- topic-bound 本地迭代计划与阶段拆解：`.local/work/<topic-id>/**`。
- Gate 执行结果与证据：local execution report route patterns（如 `.local/report/**`）；tracked spec 不绑定具体 `.local` 文件名。

## 4. 非目标

- 不在 domain 文档维护阶段清单与通过/失败快照。
- 不在本文件定义额外本地规则体系。
