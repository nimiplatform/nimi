# SDK Testing Gates Domain Spec

> Status: Active
> Date: 2026-03-03
> Scope: SDK 测试治理导引（门禁入口、覆盖范围、证据归档位置）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/testing-gates-contract.md`（S-GATE-001, S-GATE-020, S-GATE-070, S-GATE-080, S-GATE-090, S-GATE-091）
- `kernel/transport-contract.md`（S-TRANSPORT-003, S-TRANSPORT-006）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-005）
- `kernel/boundary-contract.md`（S-BOUNDARY-001, S-BOUNDARY-004）
- `kernel/tables/sdk-testing-gates.yaml`

## 1. 文档定位

本文件是 SDK 测试门禁导引。规范门定义在 kernel，执行计划和结果证据在开发目录维护。

## 2. 基线入口

- 一致性：`pnpm check:sdk-spec-kernel-consistency`。
- 文档漂移：`pnpm check:sdk-spec-kernel-docs-drift`。
- 覆盖率：`pnpm check:sdk-coverage`。
- 边界：`pnpm check:sdk-import-boundary`。

## 3. 关联事实源

- Runtime 方法投影：`kernel/tables/runtime-method-groups.yaml`。
- 导入边界：`kernel/tables/import-boundaries.yaml`。
- 错误码族：`kernel/tables/sdk-error-codes.yaml`。
- Provider 名称对齐基线：`spec/runtime/kernel/tables/provider-catalog.yaml`。

## 4. 执行材料位置

- 计划：`dev/plan/*`。
- 报告与审计：`dev/report/*`。

## 5. 非目标

- 不在 domain 文档定义额外测试规则编号。
- 不在本文件记录阶段性通过/失败快照。
