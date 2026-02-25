---
title: Creator Revenue Policy Skeleton
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-24
parent: INDEX.md
references:
  - ssot/economy/world-creator-economy.md
  - ssot/platform/protocol.md
  - ssot/runtime/service-contract.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Creator Revenue Policy (V0.1 必填骨架)

## 0. 文档定位（必填）

本文件定义 World Creator 收入分成的执行合同，覆盖 world 上下文内的交易与礼物分配口径。

- 当前状态：`FROZEN`
- 用途：冻结分成流程、归因规则、审计字段与结算约束
- 非目标：不定义 Creator Key 定价机制（由 `world-creator-economy.md` 定义）

## 1. 目标与约束（必填）

目标：
1. 统一 world 上下文经济事件的分成口径。
2. 保证分成可审计、可回放、可对账。
3. 支持 `extension-app` 场景下的平台/Creator/App 协同分成。

约束：
1. `MUST`：执行口径采用 strict-only，不引入 legacy 分成规则并存。
2. `MUST`：分成判定以 realm/runtime 审计事件为唯一真相源。
3. `MUST`：分成比例由 `sharePlanId` 配置承载，文档冻结流程与校验规则，不写死运营数值。

## 2. 分成域定义（必填）

### 2.1 事件类型

| 事件类型 | 说明 | 是否分成 |
|---------|------|---------|
| `world_agent_gift` | world 内 Agent 礼物事件 | 是 |
| `world_trade` | world 上下文内交易事件 | 是 |
| `extension_app_world_trade` | extension-app 绑定 world 后的交易事件 | 是 |
| `off_world_trade` | 无 world 上下文的交易事件 | 否 |

### 2.2 world 上下文判定

1. `MUST`：事件必须携带 `worldId` 且通过 world 可见性/绑定校验才可进入分成。
2. `MUST`：`extension-app` 事件必须命中有效 `worldId -> extensionAppId` 绑定关系。
3. `MUST`：未命中 world 上下文的事件不得混入 Creator 分成池。

## 3. 分成流程合同（必填）

标准流程：
1. `RevenueEvent` 写入（不可变原始事件）。
2. 归因标准化（world/app/caller/principal 维度补齐）。
3. 按 `sharePlanId` 计算分成明细。
4. 写入分账流水（平台/Creator/extension-app）。
5. 进入结算窗口聚合与出账。

执行规则：
1. `MUST`：同一 `eventId` 幂等处理，不得重复分账。
2. `MUST`：原始事件与分账结果都保留 `traceId`。
3. `MUST`：计算失败必须可重放，不得产生半分账状态。

## 4. 分成计划（Share Plan）合同（必填）

### 4.1 最小字段

- `sharePlanId`
- `eventType`
- `participants[]`（`role + accountId + percentageBps`）
- `effectiveFrom`
- `effectiveTo`（可空）
- `status`（`draft|active|retired`）

### 4.2 校验规则

1. `MUST`：`participants.percentageBps` 总和必须等于 `10000`。
2. `MUST`：`world_*` 事件中必须存在 `creator` 角色。
3. `MUST`：`extension_app_world_trade` 事件中必须存在 `platform + creator + extension_app` 三方角色。
4. `MUST`：`active` 计划变更后仅影响新事件，不回写历史分账结果。

## 5. 防绕过与归因（必填）

1. `MUST`：分成事件必须包含 `callerKind + callerId + appId + principalId`。
2. `MUST`：`extension-app` 事件必须记录 `extensionAppId` 与 `bindingId`。
3. `MUST`：若检测到 world 上下文字段冲突（如 `worldId` 与绑定不一致），必须拒绝并审计。
4. `MUST`：未经授权的跨 App 读取或交易请求不得进入分成流程。

## 6. 账本与对账（必填）

### 6.1 双账本模型

| 账本 | 用途 |
|------|------|
| `key_fiat_earmarked_ledger` | Creator Key 法币专项收入 |
| `ops_spark_gem_ledger` | Spark/Gem 运营分账与结算 |

规则：
1. `MUST`：Key 收入与运营分账分账本记账，不允许混账。
2. `MUST`：跨账本报表必须提供可追踪对账键（`reconcileId`）。
3. `SHOULD`：按固定窗口输出公开披露报表。

## 7. 集成点（必填）

| 系统 | 集成职责 |
|------|---------|
| `CreatorRevenueDistributionService` | 分账计算与落账执行 |
| `CurrencyTransaction` | 原始经济事件与分账流水记录 |
| `WorldAccessControl` | world 绑定与权限校验辅助 |
| `runtime audit` | caller/source/trace 归因数据来源 |
| `platform protocol` | L0 metadata 与错误语义对齐 |

## 8. 验收标准（必填）

- [ ] 事件分成域判定测试通过（world/on-world/off-world）
- [ ] `sharePlanId` 校验测试通过（sum=10000、角色完整性）
- [ ] `extension-app` 三方分成测试通过
- [ ] 分账幂等与重放测试通过
- [ ] 双账本对账测试通过（key_fiat vs spark/gem）
- [ ] 审计字段完整性测试通过（trace/caller/world/app/principal）

## 9. 决策收敛（必填）

### 9.1 已决策（2026-02-24）

- [是] 分成流程固定，比例通过 `sharePlanId` 配置，不写死在协议文档
- [是] `extension-app` 分成采用三方结构（platform/creator/extension-app）
- [是] Key 收入与 Spark/Gem 运营收入采用双账本模型

### 9.2 待定项

- 当前无待定项（新增待定需先写入 `INDEX.md` 决策记录）。
