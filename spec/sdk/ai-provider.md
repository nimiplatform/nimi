# AI Provider SDK Domain Spec

> Scope: `@nimiplatform/sdk/ai-provider` 主题导引（协议适配、runtime 映射、流行为）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/ai-provider-contract.md`（S-AIP-001, S-AIP-002, S-AIP-003, S-AIP-004, S-AIP-005）
- `kernel/surface-contract.md`（S-SURFACE-001, S-SURFACE-002）
- `kernel/transport-contract.md`（S-TRANSPORT-002, S-TRANSPORT-003）
- `kernel/error-projection.md`（S-ERROR-001）
- `kernel/boundary-contract.md`（S-BOUNDARY-001）

## 1. 文档定位

本文件是 ai-provider 子路径导引。该子路径负责协议适配与 runtime 调用映射，不承担路由决策。

## 2. 阅读路径

1. 主合同：`kernel/ai-provider-contract.md`。
2. 子路径与方法治理：`kernel/surface-contract.md`。
3. 流式与重建语义：`kernel/transport-contract.md`。
4. 错误投影：`kernel/error-projection.md`。

## 3. 关联上游

- runtime AI 语义：`spec/runtime/kernel/rpc-surface.md`。
- ScenarioJob 语义：`spec/runtime/kernel/scenario-job-lifecycle.md`。

## 4. 非目标

- 不在 domain 文档定义 provider 能力矩阵。
- 不在本文件维护执行态兼容结论。
