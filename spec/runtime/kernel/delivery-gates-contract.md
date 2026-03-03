# Runtime Delivery Gates Contract

> Owner Domain: `K-GATE-*`

## K-GATE-001 Gate Set Completeness

runtime 交付门集合由 `runtime-delivery-gates.yaml` 管理，gate 不得在执行态文档中分叉定义。

## K-GATE-010 G0 SSOT Freeze

进入实施前必须冻结规范来源与规则编号。

## K-GATE-020 G1 Proto Gate

proto lint/breaking/generate/drift 必须全部通过。

## K-GATE-030 G2 SDK Gate

SDK 投影、边界、错误语义与文档漂移检查必须通过。

## K-GATE-040 G3 Provider Gate

provider 覆盖矩阵、可用性探测、错误映射必须满足基线。

## K-GATE-050 G4 Workflow Async Gate

external async 事件与任务语义必须一致可追溯。

## K-GATE-060 G5 Test Matrix Gate

至少覆盖 provider x modality x route x sync/async x failure class 的矩阵。

## K-GATE-070 G6 Observability Gate

关键路径必须提供审计与结构化日志，禁止黑盒失败。

## K-GATE-080 G7 Release Candidate Gate

发布候选必须满足 gate 结果齐备与回归全绿。

## K-GATE-090 Evidence Routing

执行计划写 `dev/plan/*`，执行证据写 `dev/report/*`，spec 不承载运行快照。
