# Economy Contract

> Owner Domain: `R-ECON-*`

## R-ECON-001 — Creator Key 机制

一账户一 Key。无赠送/转让。无激活时限。激活选目标（一次性、不可逆）。绑定即消耗。阶梯定价详见 `tables/creator-key-tiers.yaml`。

设计原则：价格是最好的筛选机制。Key 收入用于平台建设，不作为盈利内容。

同池机制：无官方免费发放路径（前期引导阶段除外，上限 20 个，占同池配额，引导期结束后永久关闭）。Tier 8 不设总量上限。

## R-ECON-010 — 收入事件类型

事件类型与分成规则详见 `tables/revenue-event-types.yaml`。

`MUST`: 事件必须携带 worldId 且通过 world 可见性/绑定校验。extension-app 事件必须命中有效绑定。未命中 world 上下文的事件不得混入分成池。

`off_world_trade` 事件（subject_to_share: false）记入平台运营账本（ops_spark_gem_ledger），不进入 Creator 分成池。此类事件仍须携带 callerKind + callerId + principalId 审计字段（R-ECON-040），以满足对账与审计要求。

## R-ECON-011 — 礼物结算语义

`MUST`: `sendGift` 必须引用 gift catalog 中的有效礼物项，发送方按礼物目录的 `sparkCost` 支付 Spark。

`MUST`: `sendGift` 创建的是 gift transaction，不得被实现为直接向接收方账户充值 Gem。

`MUST`: 接收方 Gem 入账发生在 `acceptGift` 后；若接收方为 agent，则继续沿用既有 `gemToReceiver` / `gemToCreator` 语义完成分配。

`MUST`: `rejectGift` / `refund` 等后续状态流转继续围绕 gift transaction 执行，不得跳过交易态直接修改 Gem 余额。

`MUST`: GiftTransaction 不承载独立提现完成态；接收方后续提现继续走通用 wallet withdrawal 流程，不得把 gift transaction 伪装成独立 claim ledger。

## R-ECON-020 — 分成计划（Share Plan）

Share Plan 字段与校验规则详见 `tables/share-plan-fields.yaml`。

标准流程：RevenueEvent 写入 → 归因标准化 → 按 sharePlanId 计算分成 → 写入分账流水 → 结算窗口聚合。

结算窗口时长由 `settlementWindowSeconds` 字段定义（约束：60..86400，对齐 P-PROTO-102 economy primitive）。详见 `tables/share-plan-fields.yaml`。

`MUST`: 同一 eventId 幂等处理。原始事件与分账结果保留 traceId。计算失败必须可重放。

## R-ECON-021 — 分成比例校验

`MUST`: `participants.percentageBps` 总和必须等于 10000。

## R-ECON-022 — World 事件角色

`MUST`: `world_*` 事件中必须存在 creator 角色。

## R-ECON-023 — Extension-App 三方分成

`MUST`: `extension_app_world_trade` 事件中必须存在 platform + creator + extension_app 三方角色。

## R-ECON-024 — 计划变更规则

`MUST`: active 计划变更后仅影响新事件，不回写历史分账结果。

## R-ECON-025 — Share Plan 互斥约束

`MUST`: 同一 eventType 同一时刻最多一个 active Share Plan。激活新计划 MUST 先退休（retired）同 eventType 的前计划。时间重叠校验基于 effectiveFrom / effectiveTo 区间，effectiveTo 为空表示无限期有效。

## R-ECON-030 — 双账本模型

`MUST`: Key 收入与运营分账分账本记账（key_fiat_earmarked_ledger vs ops_spark_gem_ledger），不允许混账。跨账本报表必须提供可追踪对账键（reconcileId）。

## R-ECON-040 — 防绕过

`MUST`: 分成事件必须包含 callerKind + callerId + appId + principalId。extension-app 事件必须记录 extensionAppId 与 bindingId。world 上下文字段冲突必须拒绝并审计。
