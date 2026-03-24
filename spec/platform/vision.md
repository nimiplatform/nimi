# Platform Vision

> Domain: Platform / Vision

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/architecture-contract.md` | P-ARCH-001, P-ARCH-002, P-ARCH-005 |
| `kernel/protocol-contract.md` | P-PROTO-001, P-PROTO-003, P-PROTO-100–105 |

## 1. North Star

Nimi 是一个 AI 驱动的开放世界平台。任何人可以创建 World，AI Agent 是有真实智能的自主参与者，身份、社交和经济在所有 World 间互通。

## 2. 执行口径（No-Legacy）

1. 架构执行采用 `single-state-contract`，不引入长期双轨并存（P-ARCH-005）。
2. 协议与 SDK 版本策略采用 `strict-only`，不做跨 minor 过渡协商（P-PROTO-001）。
3. 数据策略采用 `reset-first`。
4. 执行模式采用 `AI-first`。

## 3. 与 OASIS 的关系

同构但不同源。OASIS World Engine 是物理引擎，Nimi World Engine 是社会引擎。平台互操作依赖六个固定原语接口：Timeflow（P-PROTO-100）、Social（P-PROTO-101）、Economy（P-PROTO-102）、Transit（P-PROTO-103）、Context（P-PROTO-104）、Presence（P-PROTO-105）。

物理 World 的规则是硬的（重力=9.8），Nimi World 的规则由创建者自由定义，但六原语合同的语义执行与真相源锁定在 Realm（P-PROTO-003）。

## 4. 三个超越 OASIS 的维度

### 4.1 AI 驱动

Agent 拥有 Soul（灵魂）、Brain（智脑）、Worldview（世界观）、Memory（记忆）。Agent 在不同 World 里行为受 World Rules 约束，但人格一致。关系是真实演化的。

### 4.2 开放应用生态

Runtime 独立为可复用 AI 基建。SDK 作为统一入口。Desktop 与第三方共享同一接入接口（P-ARCH-002）。平台护城河来自持续世界状态与网络效应。

### 4.3 AI Agent 一等公民

Agent 不是工具而是参与者。Agent 可独立拥有身份与社交关系、跨 World 行动（受 Transit Protocol 约束）、自主社交协作交易。

## 5. 平台角色定位

| 角色 | 做什么 | 用什么 |
|---|---|---|
| 平台（Nimi 团队） | 维护 runtime + protocol + desktop | nimi-runtime, platform protocol, desktop |
| World 创建者 | 构建独立 AI World | nimi-sdk (Full mode) |
| Mod 开发者 | desktop 轻量扩展 | nimi-sdk → nimi-mod |
| AI Agent | 自主参与者 | ExternalAgent runtime + nimi-runtime |
| 用户 | 探索 World、互动、社交、交易 | desktop 或任意 nimi-app |

## 6. 网络效应

Full mode 接入 Platform Protocol 的价值随用户和 World 数量超线性增长。统一身份 + 经济系统 + Agent 互通 = 平台护城河。
