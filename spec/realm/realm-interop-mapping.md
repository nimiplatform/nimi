# Realm Interop Mapping

> Domain: Realm / Interop
> Status: Frozen
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/interop-mapping-contract.md` | R-INTEROP-001, R-INTEROP-002 |
| `kernel/tables/primitive-mapping-status.yaml` | 映射状态 |

## 1. 文档定位

建立 L2 Realm Core Profile（六原语）与当前 nimi-realm 实现之间的映射差距清单。

## 2. 映射矩阵

六原语映射状态见 `tables/primitive-mapping-status.yaml`（R-INTEROP-001）。当前全部为 PARTIAL 状态。

## 3. 毕业标准

Primitive 从 PARTIAL → COVERED 的毕业条件见 R-INTEROP-002。

## 4. 缺口闭合计划

执行态缺口分析与实施建议已迁移至 `dev/plan/realm-interop-gap-closure.md`。
