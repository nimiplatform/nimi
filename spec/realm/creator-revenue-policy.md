# Creator Revenue Policy

> Domain: Realm / Economy

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/economy-contract.md` | R-ECON-010–040 |
| `kernel/tables/revenue-event-types.yaml` | 事件类型 |
| `kernel/tables/share-plan-fields.yaml` | 分成计划字段 |

## 1. 分成域

事件类型见 `tables/revenue-event-types.yaml`（R-ECON-010）。world 上下文判定规则见 R-ECON-010。

## 2. 分成流程

标准流程与执行规则见 R-ECON-020。幂等、traceId、可重放。

## 3. Share Plan

字段与校验规则见 `tables/share-plan-fields.yaml`（R-ECON-020–024）。

## 4. 防绕过与归因

见 R-ECON-040。

## 5. 账本与对账

双账本模型见 R-ECON-030。

## 6. 验证路径

- CI 命令 `pnpm check:realm-spec-kernel-consistency` 与 `pnpm check:realm-spec-kernel-docs-drift` 必须通过。
- 分成计划字段变更后需验证 `tables/share-plan-fields.yaml` 与 `tables/revenue-event-types.yaml` 一致性。
