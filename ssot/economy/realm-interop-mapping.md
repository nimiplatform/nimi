---
title: Realm Primitive Mapping Skeleton
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-24
parent: INDEX.md
references:
  - ssot/platform/protocol.md
  - ssot/platform/architecture.md
  - ssot/runtime/service-contract.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Realm Mapping (V0.1 必填骨架)

## 0. 文档定位（必填）

本文件用于建立 `L2 Realm Core Profile`（六原语）与当前 `nimi-realm` 实现之间的映射差距清单。

- 当前状态：`FROZEN`
- 用途：给实现阶段提供“现有代码 -> 协议合同”的对齐入口
- 非目标：不新增产品功能，不在本文件设计新玩法/新策略

## 1. 映射方法（必填）

状态定义：
- `COVERED`：已有实现可直接对齐协议合同
- `PARTIAL`：有实现基础，但协议字段/语义/审计仍缺口
- `MISSING`：当前未发现对应实现锚点

映射原则：
1. `MUST`：只基于当前仓库已存在代码与已冻结协议合同做差距判断。
2. `MUST`：差距项必须可执行（可转成代码任务或测试任务）。
3. `MUST`：不以“先加新 feature”掩盖协议对齐缺口。

## 2. 六原语映射矩阵（必填）

| 原语 | 现有代码锚点 | 状态 | 主要差距 |
|------|--------------|------|---------|
| Timeflow | `nimi-realm`（closed-source）world timeflow domain services | `PARTIAL` | 已有时间流速/时间差计算基础，但与协议字段（tick/driftBudget/catchUpPolicy）缺统一合同层映射 |
| Social | `nimi-realm`（closed-source）social + relationship domains | `PARTIAL` | 具备社交基础能力，但与协议中的跨 World 映射与拒绝语义未形成统一 primitive 适配层 |
| Economy | `nimi-realm`（closed-source）economy + revenue-share domains | `PARTIAL` | 有交易与分账实现，但与 `conservationRequired/settlementWindow` 的协议级验证点未显式绑定 |
| Transit | `nimi-realm`（closed-source）world transit domain | `PARTIAL` | 有跨 world 迁移与配额逻辑，但协议要求的状态模型/拒绝语义/跨原语一致性校验需补齐映射 |
| Context | `nimi-realm`（closed-source）world-context domain | `PARTIAL` | 已有 world context 数据能力，但与协议中的 `contextScope/injectionPriority/handoffPolicy` 尚未形成统一合同 |
| Presence | `nimi-realm`（closed-source）user + discovery domains | `PARTIAL` | 有在线状态与可见性字段，但协议要求的 heartbeat/ttl/device merge 规则未见统一执行入口 |

## 3. 横向缺口清单（必填）

### 3.1 合同层缺口

1. 六原语缺少统一的 Realm 适配层（当前主要分散在 domain service 内）。
2. 协议字段与现有 DTO/Prisma 字段之间缺少一份稳定映射表。
3. 拒绝语义（`reasonCode + actionHint`）在 Realm 侧未形成 primitive 维度清单。

### 3.2 测试层缺口

1. 缺少“协议合同 -> 现有实现”的回归测试矩阵（按六原语分组）。
2. 缺少跨原语一致性测试（如 Transit 与 Social/Economy/Context 联动）。
3. 缺少 primitive 级审计字段完整性测试。

### 3.3 可观测缺口

1. 原语级 trace 对账入口未统一（实现分散，难做全链路核验）。
2. Realm 原语拒绝分布统计缺少固定查询口径。

## 4. 执行建议（当前阶段最小集）

1. 建立 `primitive-adapter` 映射表（不改业务规则，先做字段/语义映射固化）。
2. 为六原语各补一组 contract tests（输入约束 + 拒绝语义 + 审计字段）。
3. 补一份 `reasonCode/actionHint` Realm 执行投影清单，对齐 `platform-protocol`。
4. 在 CI 增加 primitive mapping gate：映射表变更必须伴随测试与文档更新。

## 5. 验收标准（必填）

- [ ] 六原语全部建立“协议字段 -> 现有实现”映射条目
- [ ] 每个原语至少 1 组 contract tests 落地并可重复运行
- [ ] 跨原语一致性测试最小集通过（Transit x Social/Economy/Context）
- [ ] Realm 拒绝语义可输出统一 `reasonCode + actionHint`
- [ ] 映射文档与代码锚点保持可追踪（路径有效、责任域明确）

## 6. 决策收敛（必填）

### 6.1 已决策（2026-02-24）

- [是] 当前阶段先做“映射与缺口”而非新增 realm feature
- [是] 六原语映射文档作为实现阶段输入，不改写协议真相源
- [是] 映射结果必须可转化为测试与 gate

### 6.2 待定项

- 当前无待定项（新增待定需先写入 `INDEX.md` 决策记录）。
