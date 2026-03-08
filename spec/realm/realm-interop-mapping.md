# Realm Interop Mapping

> Domain: Realm / Interop

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/interop-mapping-contract.md` | R-INTEROP-001, R-INTEROP-002 |
| `kernel/tables/primitive-mapping-status.yaml` | 映射状态 |
| `kernel/tables/primitive-graduation-log.yaml` | 毕业记录 |
| `kernel/tables/rule-evidence.yaml` | R-* 规则证据映射 |

## 1. 文档定位

建立 L2 Realm Core Profile（六原语）与当前 nimi-realm 实现之间的映射差距清单。
上游六原语主权与字段合同以 `spec/platform/kernel/protocol-contract.md` 和 `spec/platform/kernel/tables/protocol-primitives.yaml` 为准，本文件只声明 Realm 侧映射状态与毕业语义。

## 2. 映射矩阵

六原语映射状态见 `tables/primitive-mapping-status.yaml`（R-INTEROP-001）。`timeflow` 与 `economy` 已进入 COVERED，其余 primitive 仍为 PARTIAL。毕业证据记录见 `tables/primitive-graduation-log.yaml`。

## 3. 毕业标准

Primitive 从 PARTIAL → COVERED 的毕业条件见 R-INTEROP-002。
其中 contract test 与 CI gate 由承载实现的下游层执行并留证：通常落在 `spec/runtime/*`、`spec/sdk/testing-gates.md`、`spec/desktop/testing-gates.md` 与 `dev/report/*`，Realm domain 不单独定义第二套 gate 模型。R-* 的 formal 证据映射以 `kernel/tables/rule-evidence.yaml` 为唯一事实源。

## 4. 缺口闭合计划

执行态缺口分析与实施建议已迁移至 `dev/plan/realm-interop-gap-closure.md`。
