# SDK Testing Gates Domain Spec

> Scope: SDK 测试治理导引（门禁入口、覆盖范围、证据归档位置）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/testing-gates-contract.md`（S-GATE-001, S-GATE-010, S-GATE-020, S-GATE-030, S-GATE-040, S-GATE-050, S-GATE-060, S-GATE-070, S-GATE-080, S-GATE-090, S-GATE-091）
- `kernel/surface-contract.md`（S-SURFACE-001, S-SURFACE-005, S-SURFACE-006）
- `kernel/transport-contract.md`（S-TRANSPORT-003, S-TRANSPORT-006）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-002, S-ERROR-005）
- `kernel/boundary-contract.md`（S-BOUNDARY-001, S-BOUNDARY-004）
- `kernel/mod-contract.md`（S-MOD-004）
- `kernel/tables/sdk-testing-gates.yaml`
- `kernel/tables/rule-evidence.yaml`

## 1. 文档定位

本文件是 SDK 测试门禁导引。规范门定义在 kernel，执行计划和结果证据在开发目录维护。
其中 contract/boundary hard-cut 入口对应 `S-BOUNDARY-004`、`S-SURFACE-001`、`S-SURFACE-005`、`S-SURFACE-006`、`S-ERROR-002`，mod/hook hard-cut 对应 `S-MOD-004`。

## 2. 门禁入口

- 单元/模块：`pnpm --filter @nimiplatform/sdk test`。
- consumer smoke：`pnpm check:sdk-consumer-smoke`。
- 文档漂移：`pnpm check:sdk-spec-kernel-docs-drift`。
- 一致性：`pnpm check:sdk-spec-kernel-consistency`。
- 覆盖率：`pnpm check:sdk-coverage`。
- 合同 / 边界：`pnpm check:sdk-import-boundary`、`pnpm check:sdk-public-naming`、`pnpm check:no-create-nimi-client`、`pnpm check:no-global-openapi-config`、`pnpm check:sdk-realm-legacy-clean`、`pnpm check:no-app-realm-rest-bypass`、`pnpm check:reason-code-constants`、`pnpm check:sdk-single-package-layout`。
- Runtime 投影：`pnpm check:runtime-bridge-method-drift`。
- vNext 矩阵：`pnpm check:sdk-vnext-matrix`。
- Mod/Scope 边界：`pnpm check:mods-no-runtime-sdk`、`pnpm check:runtime-mod-hook-hardcut`。
- Provider 对齐：`pnpm check:live-provider-invariants`。
- Live smoke：`node scripts/run-live-test-matrix.mjs` 与 `pnpm check:live-smoke-gate`。
- 发布一致性：`pnpm check:sdk-version-matrix` 与 `pnpm check:live-smoke-gate --require-release`。

## 3. 关联事实源

- Runtime 方法投影：`kernel/tables/runtime-method-groups.yaml`。
- 导入边界：`kernel/tables/import-boundaries.yaml`。
- 错误码族：`kernel/tables/sdk-error-codes.yaml`。
- 测试门集合：`kernel/tables/sdk-testing-gates.yaml`。
- 规则证据映射：`kernel/tables/rule-evidence.yaml`。
- Provider 名称对齐基线：`spec/runtime/kernel/tables/provider-catalog.yaml`。
- Live smoke 证据：`dev/report/live-test-coverage.yaml`。

## 4. 执行材料位置

- 计划：`dev/plan/*`。
- 报告与审计：`dev/report/*`。

## 5. 非目标

- 不在 domain 文档定义额外测试规则编号。
- 不在本文件记录阶段性通过/失败快照。
