---
title: World Creator Economy — Creator Key & World Lifecycle
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-24
parent: INDEX.md
references:
  - ssot/boundaries/world.md（WorldAccessControl、World Level 指标）
  - ssot/economy/creator-revenue-policy.md（Gem 收益分配、Creator Revenue Distribution）
  - ssot/economy/creator-revenue-policy.md（World 收入分成专题）
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# World Creator Economy

## 1. 核心理念

World 是 Nimi OASIS 的核心资产。World Creator 是平台的基石。

**设计哲学**：
- 平台是基础设施，不是造物主
- 规则一经设定，平台自身也受约束
- 价格是最好的筛选机制
- Creator Key 收入用于平台建设，不作为盈利内容

## 2. Creator Key 机制

### 2.1 基本规则

| 规则 | 说明 |
|------|------|
| 一账户一 Key | 每个 realm 账户仅能购买一个 Creator Key |
| 无赠送/转让 | Key 绑定购买账户，不可转移 |
| 无激活时限 | 购买后可随时激活，不设过期 |
| 激活选目标 | 激活时可选择绑定到自己或**其他账户**（一次性、不可逆） |
| 绑定即消耗 | Key 激活后消失，目标账户获得 World 创建权（WorldAccessControl） |

### 2.2 "激活选目标" 详解

```
账户 A 购买 Key
    │
    ├── 激活到自己 → 账户 A 获得 World 创建权
    │
    └── 激活到账户 B → 账户 B 获得 World 创建权
                       账户 A 的 Key 消耗，永久失去购买资格
```

这个设计同时满足三种需求：
- **自用**：买了给自己激活
- **送人**：买了激活到朋友账户（真正的礼物——你牺牲了自己唯一的购买权）
- **"交易"**：私下协商后激活到对方账户（平台不运营交易市场，不介入）

### 2.3 实现映射

Creator Key 落地为现有 `WorldAccessControl` 的授权来源：

```
购买 Creator Key
  → 创建 CreatorKey 记录（status: PURCHASED, ownerId: 购买者）
  → 一账户一 Key 约束：购买前检查 hasPurchasedKey

激活 Creator Key
  → CreatorKey.status: PURCHASED → ACTIVATED
  → CreatorKey.activatedFor: 目标账户 ID
  → 创建 WorldAccessControl（userId: 目标账户, canCreateWorld: true, status: ACTIVE）
  → 目标账户进入 world-studio CREATE 流程
```

## 3. 阶梯定价（非匀速）

### 3.1 定价曲线

采用**非匀速阶梯**：前期缓升吸引种子用户，中后期陡升制造稀缺。

| Tier | Key 编号 | 单价 (USD) | 本阶梯容量 | 累计 Key 数 | 累计收入 (USD) |
|------|---------|-----------|-----------|------------|---------------|
| 1 | #1 - #20 | $20 | 20 | 20 | $400 |
| 2 | #21 - #50 | $50 | 30 | 50 | $1,900 |
| 3 | #51 - #100 | $120 | 50 | 100 | $7,900 |
| 4 | #101 - #200 | $300 | 100 | 200 | $37,900 |
| 5 | #201 - #400 | $800 | 200 | 400 | $197,900 |
| 6 | #401 - #700 | $2,000 | 300 | 700 | $797,900 |
| 7 | #701 - #1000 | $5,000 | 300 | 1000 | $2,297,900 |
| 8 | #1001+ | $10,000+ | 开放 | ∞ | — |

注：具体数值为示意，正式上线前需根据市场调研调整。核心设计点是**非匀速**——从 $20 到 $120 只跨了两个 Tier（80 个 Key），之后迅速攀升。

### 3.2 定价设计原则

- **前 50 个 Key 足够便宜**（$20-$50）：吸引种子 World Creator，建立生态基底
- **100 个以后显著提价**（$300+）：此时平台已有足够 World 证明模式，稀缺性产生真实价值
- **价格本身就是防线**：不需要额外的反囤积机制。批量注册账号各买一个？第 51 个就是 $120，第 101 个 $300，经济上不可行
- **Tier 8 开放**：不设总量上限，但价格足够高，自然限流

### 3.3 同池机制

Creator Key 只有一个池子：

- **无官方免费发放路径**（前期引导阶段除外，规则中写明截止时间）
- 平台自身也不能绕过定价机制给人 Key

> 前期引导阶段（平台上线首 6 个月）：平台可邀请种子 Creator 免费获得 Key（V1 上限 20 个），但占用同一池子配额，消耗正常 Tier 编号。引导期结束后此路径永久关闭。

## 4. World 生命周期风险（概念占位）

### 4.1 当前定位

- 当前仅保留“World 生命周期风险”的概念锚点，不在本轮设计中定义可执行规则。
- 本轮目标是先完成 Creator Key 机制与经济闭环，不引入额外治理状态机。
- 任何“坍缩/回收/资格剥夺”的具体判定条件，都延后到后续治理专项文档。

### 4.2 后续落点（占位）

后续若进入实质设计，统一在治理专项中补齐：

1. 生命周期状态定义与审计事件。
2. 触发条件、观察窗口与恢复机制。
3. 资格回收与名额回池规则。
4. 与 World Level 指标的映射关系。
5. 申诉与人工治理流程。

## 5. World Creator 的收入

Creator Key 不是一次性消费。World Creator 通过运营 World 获得持续收入。

### 5.1 现有收入体系（参考 `ssot/economy/creator-revenue-policy.md`）

| 收入来源 | 机制 |
|---------|------|
| Agent 礼物分成 | World-Owned Agent 收到礼物时，`gemToCreator` 部分归 Creator |
| Creator 收益分配池 | `CreatorRevenueDistributionService` 按 World 指标（Q/C/A/E）加权分配 |

### 5.2 World Level 与收入的关系

World Level 越高：
- `worldOwnedAgentLimit` 越大 → 更多 Agent 产生礼物收入
- `transitInLimit/day` 越大 → 更多用户流入 → 更多互动和消费
- 分配池权重更高 → Creator 收益占比更大

这形成了正向循环：**好的 World 运营 → 更高 Level → 更多资源配额 → 更多收入 → 更好的运营投入**。

### 5.3 Key 购买成本 vs World 收入

Creator Key 的定价应当让一个运营良好的 World 能在合理周期内回本：

- Tier 1 ($20)：种子期 World 只需极少互动即可覆盖成本
- Tier 4 ($300)：需要 Lv.3+ 的稳定运营才能回本，筛选出认真的 Creator
- Tier 7 ($5,000)：需要 Lv.5+ 的高质量 World，面向有资源的 IP 方或专业团队

## 6. Key 收入用途

Creator Key 销售收入**专项用于平台建设**，不计入公司利润：

| 用途 | 说明 |
|------|------|
| 基础设施 | nimi-runtime / nimi-realm 服务器与运维 |
| 开源生态 | 开发者文档、SDK 维护、社区运营 |
| OASIS 主世界 | 主世界内容与 Agent 质量提升 |
| 安全审计 | Mod Circle 审计、World 内容安全 |

这一承诺需要透明化：定期公开 Key 收入与支出报告。

## 7. 与现有系统的集成点

| 现有系统 | 集成方式 |
|---------|---------|
| `WorldAccessControl` | Creator Key 激活 → 创建 ACTIVE 权限记录 |
| `WorldDraft` | 获得创建权后进入 world-studio CREATE 流程 |
| `World Level` (Lv.1-10) | 生命周期风险评估的后续参考指标（概念阶段） |
| `CreatorRevenueDistributionService` | World 运营收入的分配引擎 |
| `CurrencyTransaction` | Key 购买记录写入新类型 `CREATOR_KEY_PURCHASE` |
| `Subscription` (FREE/PRO/MAX) | V1 不设最低订阅门槛，Key 购买资格与订阅解耦 |

## 8. 决策收敛（V1）

### 8.1 已决策（2026-02-24）

- [是] 购买 Key 不设最低订阅等级（价格本身作为门槛）
- [是] 前期引导阶段免费 Key 上限固定为 20 个（占同池配额）
- [是] Tier 8 不设总量上限（价格高位自然限流）
- [是] Key 购买走法币通道（USD/CNY），与 Spark 消费体系分离

### 8.2 后续专题（不阻塞 V1）

- Creator 收入分成专题已拆分至 `creator-revenue-policy.md`，本文件不再承载分成细则。
