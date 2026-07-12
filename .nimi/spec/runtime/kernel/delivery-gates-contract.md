# Runtime Delivery Gates Contract

> Owner Domain: `K-GATE-*`

## K-GATE-001 Gate Set Completeness

runtime 交付门集合由 `runtime-delivery-gates.yaml` 管理，gate 不得在执行态文档中分叉定义。

## K-GATE-010 G0 SSOT Freeze

进入实施前必须冻结规范来源与规则编号。

执行命令（PR 必须通过）：

- `pnpm check:ai-scenario-hardcut-drift`
- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope runtime-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope runtime --check`

## K-GATE-020 G1 Proto Gate

proto lint/breaking/generate/drift 与 proto-spec linkage 必须全部通过。

执行命令（PR 必须通过）：

- `pnpm proto:lint`
- `pnpm proto:generate`
- `pnpm proto:breaking`
- `pnpm proto:drift-check`
- `pnpm check:runtime-proto-spec-linkage`

## K-GATE-030 G2 SDK Gate

SDK 投影、边界、错误语义、P-MOEX anti-target hard-cut 与文档漂移检查必须通过。

执行命令（PR 必须通过）：

- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope sdks-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope sdks --check`
- `pnpm check:runtime-bridge-generated-drift`
- `pnpm check:p-moex-anti-targets`

## K-GATE-040 G3 Provider Gate

provider 覆盖矩阵、runtime Go statements coverage、catalog/source drift、provider canonicalization、endpoint SSOT、activation 对齐、视频能力块 enforcement、可用性探测与错误映射必须满足基线。

执行命令（PR 必须通过）：

- `pnpm check:runtime-go-coverage`
- `pnpm check:no-legacy-cloud-provider-keys`
- `pnpm check:runtime-ai-scenario-coverage`
- `pnpm check:live-provider-invariants`
- `pnpm check:runtime-catalog-drift`
- `pnpm check:runtime-provider-activation-alignment`
- `pnpm check:runtime-provider-alias-hardcut`
- `pnpm check:runtime-provider-capability-token-canonicalization`
- `pnpm check:runtime-provider-endpoint-ssot`
- `pnpm check:runtime-provider-yaml-first-hardcut`
- `pnpm check:runtime-video-capability-block-enforcement`

阻断语义：

- 任一命令失败均阻断 Runtime 进入下游层（SDK/Desktop）。

证据路由：

- tracked baseline/config：`config/live/live-gate-baseline.yaml`
- local latest-run report route patterns（如 `.local/report/**`）

## K-GATE-050 G4 Workflow Async Gate

external async 事件与任务语义必须一致可追溯。

## K-GATE-060 G5 Test Matrix Gate

至少覆盖 provider x modality x route x sync/async x failure class 的矩阵。

执行命令：

- `node scripts/run-live-test-matrix.mjs`

阻断策略：

- PR：允许未配置 provider 的单元以 `skipped` 通过（skip-safe）。
- 夜间与发布前：required provider 若出现 `failed` 或 `skipped`，必须阻断。

证据路由：

- tracked baseline/config：`config/live/live-gate-baseline.yaml`
- local latest-run report route patterns（如 `.local/report/**`）

## K-GATE-070 G6 Observability Gate

关键路径必须提供审计与结构化日志，禁止黑盒失败。

执行命令（PR 必须通过）：

- `cd runtime && go run ./cmd/runtime-compliance --gate`

阻断语义：

- compliance gate 未通过时，SDK/Desktop 层不得继续执行 workaround 调试。

## K-GATE-080 G7 Release Candidate Gate

发布候选必须满足 gate 结果齐备与回归全绿。

执行命令（发布前硬门）：

- `pnpm check:live-smoke-gate --require-release`

阻断语义：

- required provider 出现 `failed` 或 `skipped` 时，release job 必须在 publish 前终止。

证据路由：

- tracked baseline/config：`config/live/live-gate-baseline.yaml`
- local latest-run report route patterns（如 `.local/report/**`）

## K-GATE-090 Evidence Routing

repository task / plan / resume state 遵循 `P-PKG-010` 的 external-host ownership，不属于 Runtime authority。必要的冻结工件和非权威 evidence dossier 可写入 `.local/work/<work-id>/**`，local-only 执行证据可写入 `.local/report/**`；tracked spec 不依赖具体 local 文件，spec 不承载运行快照或 task lifecycle mirror。
