# Multimodal Provider Domain Spec

> Scope: 多模态 provider 主题导引（canonical 字段、任务语义、路由一致性）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/multimodal-provider-contract.md`（canonical inputs：K-MMPROV-001~005；async/artifact/adapter/route：K-MMPROV-006~012；voice catalog 与 diagnostics：K-MMPROV-013~015；local image workflow：K-MMPROV-016~017；voice workflow：K-MMPROV-018~023；video：K-MMPROV-024~027；inclusion/deferred：K-MMPROV-028~029；music iteration/fail-close：K-MMPROV-030~037）
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
5. image / video / TTS / STT canonical inputs 与 guardrails：`kernel/multimodal-provider-contract.md`（K-MMPROV-001~005, K-MMPROV-024~025）。
6. adapter obligations、cloud/local route、validation fail-close 与 local image workflow：`kernel/multimodal-provider-contract.md`（K-MMPROV-008~012, K-MMPROV-016~017）。
7. voice catalog、workflow canonical inputs、timing/alignment 与 status mapping：`kernel/multimodal-provider-contract.md`（K-MMPROV-013~023）。
8. async task endpoints、status normalization、deferred custom voice extension 与 music iteration fail-close：`kernel/multimodal-provider-contract.md`（K-MMPROV-026~037）。

## 3. 关联材料

- Companion 指南：`kernel/companion/multimodal-provider-guide.md`。
- topic-bound 执行计划：`nimi-coding/.local/<topic-id>/**`。
- 审计与覆盖结果：`nimi-coding/.local/report/*`。

## 4. 非目标

- 不在本文件定义独立规则号。
- 不在 domain 层维护执行清单正文。
