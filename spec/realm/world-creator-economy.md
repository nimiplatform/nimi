# World Creator Economy

> Domain: Realm / Economy
> Status: Frozen
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/economy-contract.md` | R-ECON-001, R-ECON-010, R-ECON-030 |
| `kernel/tables/creator-key-tiers.yaml` | 阶梯定价表 |

## 1. 核心理念

World 是 Nimi OASIS 的核心资产。设计哲学：平台是基础设施、规则一经设定平台也受约束、价格是筛选机制、Key 收入用于平台建设（R-ECON-001）。

## 2. Creator Key 详述

基本规则与激活机制见 R-ECON-001。定价曲线见 `tables/creator-key-tiers.yaml`。

Key 购买与激活实现映射：CreatorKey 记录（PURCHASED → ACTIVATED）→ WorldAccessControl（canCreateWorld: true）→ world-studio CREATE 流程。

## 3. Key 购买成本 vs World 收入

Tier 1 ($20): 种子期极少互动即可覆盖。Tier 4 ($300): 需 Lv.3+ 稳定运营。Tier 7 ($5,000): 需 Lv.5+ 高质量 World。

## 4. Key 收入用途

专项用于：基础设施、开源生态、OASIS 主世界、安全审计。定期公开收入与支出报告。

## 5. 决策收敛

购买不设最低订阅等级。引导阶段免费 Key 上限 20 个。Tier 8 不设总量上限。Key 走法币通道与 Spark 消费体系分离。
