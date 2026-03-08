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

字段与校验规则见 `tables/share-plan-fields.yaml`（R-ECON-020–025）。

当前 Share Plan 校验最小集合如下：

- `R-ECON-021`: `participants.percentageBps` 总和必须等于 10000。
- `R-ECON-022`: `world_*` 事件必须包含 creator 角色。
- `R-ECON-023`: `extension_app_world_trade` 必须同时包含 platform、creator、extension_app 三方角色。
- `R-ECON-024`: active 计划变更仅影响新事件，不得回写历史分账结果。
- `R-ECON-025`: 同一 eventType 同一时刻最多一个 active Share Plan，新计划激活前必须退休旧计划。

## 4. 防绕过与归因

见 R-ECON-040。

## 5. 账本与对账

双账本模型见 R-ECON-030。

## 6. 验证路径

- CI 命令 `pnpm check:realm-spec-kernel-consistency` 与 `pnpm check:realm-spec-kernel-docs-drift` 必须通过。
- 分成计划字段变更后需验证 `tables/share-plan-fields.yaml` 与 `tables/revenue-event-types.yaml` 一致性。
