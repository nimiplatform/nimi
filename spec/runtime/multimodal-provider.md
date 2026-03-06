# Multimodal Provider Domain Spec

> Scope: 多模态 provider 主题导引（canonical 字段、任务语义、路由一致性）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/multimodal-provider-contract.md`（K-MMPROV-001, K-MMPROV-006, K-MMPROV-007, K-MMPROV-009, K-MMPROV-012）
- `kernel/scenario-job-lifecycle.md`（K-JOB-001, K-JOB-002）
- `kernel/provider-health-contract.md`（K-PROV-001, K-PROV-002, K-PROV-006）
- `kernel/streaming-contract.md`（K-STREAM-001, K-STREAM-003, K-STREAM-004）
- `kernel/workflow-contract.md`（K-WF-005）
- `kernel/tables/multimodal-canonical-fields.yaml`
- `kernel/tables/multimodal-artifact-fields.yaml`

## 1. 文档定位

本文件是多模态 provider 导引文档。canonical 输入、异步任务、artifact 与适配约束由 kernel 统一定义。

## 2. 阅读路径

1. 主合同：`kernel/multimodal-provider-contract.md`。
2. 任务生命周期：`kernel/scenario-job-lifecycle.md`。
3. provider 健康与命名：`kernel/provider-health-contract.md`。
4. workflow external async：`kernel/workflow-contract.md`。

## 3. 关联材料

- Companion 指南：`kernel/companion/multimodal-provider-guide.md`。
- 执行计划：`dev/plan/*`。
- 审计与覆盖结果：`dev/report/*`。

## 4. 非目标

- 不在本文件定义独立规则号。
- 不在 domain 层维护执行清单正文。
