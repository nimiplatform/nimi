---
title: "North Star: AI-native OASIS"
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-24
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# North Star: AI-native OASIS

## 一句话

Nimi 是一个 AI 驱动的开放世界平台 — 任何人可以创建 World，AI Agent 是有真实智能的自主参与者，身份、社交和经济在所有 World 间互通。

## 当前执行口径（No-Legacy）

1. 架构执行采用 `single-state-contract`，不引入长期双轨并存。
2. 协议与 SDK 版本策略采用 `strict-only`，不做跨 `minor` 过渡协商。
3. 数据策略采用 `reset-first`（项目未上线，不做 legacy 数据迁移）。
4. 执行模式采用 `AI-first`（自动化默认，人工负责 Go/No-Go 与风险兜底）。

## 与 OASIS 的关系：同构但不同源

### 同构映射

| OASIS (Ready Player One) | Nimi (AI-native) | 实现状态 |
|--------------------------|------------------|---------|
| OASIS 平台 | nimi-runtime（独立基础设施服务） | 设计中 |
| 用户身份（跨 World 通用） | nimi-realm auth 统一身份 | 已实现 |
| World（星球/空间） | World 定义（L1-foundation） | 已实现 |
| World 内的 NPC/角色 | Agent 系统（brain + soul + worldview） | 已实现 |
| 跨 World 通用货币与资产 | nimi-realm economy | 已实现 |
| 社交关系（跨 World） | nimi-realm social model | 已实现 |
| World 内小游戏/体验 | nimi-mods（desktop 内小程序） | 框架已实现，12 个规划中 |
| 独立 World 创建者 | nimi-apps (Full mode) 开发者 | FROZEN（生态合同已落地） |
| World 间传送/互通 | Transit Protocol（身份/Agent/资产跨 World 映射） | 设计中 |
| OASIS 终端（VR 头盔） | desktop（第一方客户端） | 已实现 |
| 物理引擎 | **不需要** — 见下方 "World Engine 差异" | — |

### World Engine 差异：物理引擎 vs 社会引擎

OASIS 的 World Engine 是**物理引擎** — 重力、碰撞、光照、渲染。它模拟的是"看起来真实的空间"。

Nimi 的 World Engine 是**社会引擎** — AI Agent 不需要物理定律来"存在"，它们需要社会规则来"生活"。World 的规则可以任意制定（中世纪魔法、赛博朋克、"说谢谢会获得金币"），但平台互操作依赖六个固定原语接口：

| 平台协议原语 | 含义 | 为什么是核心 |
|-------------|------|-------------|
| **Timeflow Ratio** | World 内时间与现实时间的比率 | Agent 可以在一个 World "度过一年"而现实只过一天。时间流速直接决定 Agent 的记忆积累深度、关系演化速度、经济产出节奏。不同 World 有不同的时间密度 |
| **Social Rules** | 关系建立/衰减/声誉模型 | 谁能和谁互动、关系如何量化和衰减、声誉如何计算。这是 World 的"社会物理学"，定义了 World 内部的人际（人-Agent / Agent-Agent）动力学 |
| **Economy Rules** | 价值产生/流转/通胀通缩机制 | 资源如何产生、如何交换、稀缺性如何维持。不同 World 可以有完全不同的经济模型，但跨 World 结算必须通过平台协议 |
| **Transit Protocol** | 实体跨 World 的流动规则 | 用户/Agent/资产在跨 World 时：什么可以带走、什么留在原地、身份和状态如何映射到目标 World 的规则体系中 |
| **Context Rules** | 上下文注入/保留/切换规则 | 不同设备、不同 App、不同 World 间如何安全地延续会话上下文，决定 AI 体验是否连续 |
| **Presence Rules** | 在线状态/心跳/多设备合并规则 | 用户与 Agent 的活跃状态如何感知、超时如何收敛、冲突如何合并，决定实时协作体验 |

**物理 World 的规则是硬的（重力 = 9.8）。Nimi World 的规则由创建者自由定义 — 但六原语合同的语义执行与真相源锁定在 Realm，其他参与方只消费该合同结果。**

## 三个超越 OASIS 的维度

### 1. AI 驱动 — Agent 是有真实智能的参与者

OASIS 的 NPC 是预编程脚本。Nimi 的 Agent 拥有：

- **Soul**（灵魂）— 人格、价值观、行为模式
- **Brain**（智脑）— 真实的 AI 推理能力，而非对话树
- **Worldview**（世界观）— 对所在 World 的理解和认同
- **Memory**（记忆）— 跨会话的长期记忆，真正"认识"用户

Agent 在不同 World 里行为受 World Rules 约束，但人格（Soul）一致 — 就像一个人在不同城市生活会入乡随俗，但性格不会变。

关系是**真实演化**的 — Agent 会因为和你的互动而改变，会记住你说过的话。

### 2. 开放应用生态 — Runtime + SDK 作为平台底座

- Runtime 从 Desktop 中独立，成为可复用的 AI 基建能力层
- SDK 作为统一入口，让第三方应用不必成为 Desktop Mod 也能接入平台能力
- Desktop 作为第一方应用，和第三方应用共享同一接入接口
- 平台护城河来自持续世界状态与网络效应，而不是客户端形态绑定

### 3. AI Agent (OpenClaw) — 自主智能体作为一等公民

- Agent 不是 World 创建者的工具，而是有自主目标和行为的**参与者**
- Agent 可以独立拥有身份与社交关系
- Agent 可以跨 World 行动（受 Transit Protocol 约束）
- Agent 之间可以自主社交、协作、交易

## 平台协议栈

```
┌──────────────────────────────────────────────────┐
│               World Layer (任意)                  │
│  World Rules = 创建者自由定义的一切                 │
│  （剧情、角色设定、玩法、美术风格、物理规则...）      │
│  唯一约束：必须遵守 Realm 六原语合同（语义执行由 Realm 负责） │
├──────────────────────────────────────────────────┤
│            Platform Protocol (固定接口)            │
│                                                  │
│  Timeflow    World 声明时间流速比                  │
│  Social      关系建立/衰减/跨 World 映射            │
│  Economy     价值产生/流转/跨 World 结算            │
│  Transit     实体跨 World 准入/携带/映射            │
│  Context     上下文注入/保留/handoff               │
│  Presence    在线状态/心跳/多设备合并               │
├──────────────────────────────────────────────────┤
│              nimi-runtime (计算基建)               │
│  AI 推理 · MCP · 审计 · 沙箱 · 知识库 · 记忆       │
│  GPU 调度 · 模型管理 · App 间通信                   │
├──────────────────────────────────────────────────┤
│              基础设施层                            │
│  本地模型 · GPU · 云端 Provider                       │
└──────────────────────────────────────────────────┘
```

关键分层发现：**Platform Protocol 是独立于 nimi-runtime 的一层。**
- Runtime 提供的是**计算能力**（AI 推理、存储、通信）
- Protocol 定义的是**规则接口**（时间怎么流、钱怎么转、人怎么走）
- 这两层不应混在一起

## 用户体验链路

```
用户注册 Nimi 身份
  → 进入 desktop（或任意 nimi-app）
  → 发现各种 World（由不同创建者构建）
  → 进入一个 World
    → World 有自己的时间流速（可能 1 天 = 现实 1 小时）
    → 遇到 AI Agent（有独立人格和记忆，受 World Rules 约束）
    → 互动、社交、创造、交易
    → 获得的关系/资产/记忆跨 World 保留
  → Transit 到另一个 World
    → 同一个身份、同一个社交圈
    → Agent 同行（人格不变，行为适应新 World Rules）
    → 部分资产可携带（受 Transit Protocol 约束）
    → 遇到新的规则、新的 Agent、新的体验
```

## 平台角色定位

| 角色 | 做什么 | 用什么 |
|------|--------|-------|
| **平台**（Nimi 团队） | 维护 runtime + protocol + desktop | nimi-runtime, platform protocol, desktop |
| **World 创建者** | 构建独立的 AI World | nimi-sdk (Full mode) → nimi-app，接入 Realm 六原语合同 |
| **Mod 开发者** | 为 desktop 制作轻量扩展 | nimi-sdk → nimi-mod（desktop 内小程序） |
| **AI Agent** | 作为自主参与者存在于 World 中 | OpenClaw + nimi-runtime AI 能力 |
| **用户** | 探索 World、与 Agent/人互动、社交、交易 | desktop 或任意 nimi-app |

## 网络效应

```
更多 World 创建者 → 更丰富的 World 生态
  → 更多用户进入 → 社交图谱密度增加
    → 跨 World 身份/经济价值增加
      → 更多创建者接入 Full mode（Protocol 互通）
        → Agent 可活动范围扩大 → Agent 价值增加
          → 循环加速
```

Full mode 接入 Platform Protocol 的价值随用户和 World 数量超线性增长 — 统一身份 + 经济系统 + Agent 互通 = 平台护城河。

## 从当前到 North Star（当前主线）

已经走完的路（比想象中远）：
- 统一身份 ✓
- World / Agent 定义（含 Soul / Brain / Worldview） ✓
- 社交模型 ✓
- 经济系统 ✓
- AI 推理能力 ✓
- Mod 治理框架 ✓
- Desktop 客户端 ✓

正在走的路：
- Runtime 从 Desktop 独立（执行合同已落地，→ platform/architecture.md / runtime/service-contract.md / runtime/proto-contract.md）
- SDK 对第三方开放（导入面与版本策略已收敛，→ sdk/design.md）

正在完善的路：
- Creator 收入分成细则专题（已冻结，→ economy/creator-revenue-policy.md）
