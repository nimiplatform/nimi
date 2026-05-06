# 通行

通行是让参与者在世界之间移动的**单跳连续性协议**。创作者世界**不能**直接 peer 通行 — 每次通行都过 OASIS。这不是物流怪癖；这是连续性保证。

## 经 OASIS 单跳

| 性质 | 值 |
| --- | --- |
| 拓扑 | 中心-辐条；OASIS 是中心 |
| 创作者-到-创作者直接通行 | 禁止 |
| 通行路径 | 源世界 → OASIS → 目标世界 |
| 身份 | 通行中保留 |
| 真相修改 | 通行中无 |
| 审计 | 每跳通行被记下 |

为什么是中心-辐条而不是 peer-to-peer 通行？两条设计性质依赖它：

| 性质 | 中心-辐条怎么服务 |
| --- | --- |
| 跨世界身份连续性 | OASIS 是规范化锚；身份在跨跳时保持锚定 |
| 默认返回点 | 目标世界不可达时参与者回到 OASIS |
| 抗替代性 | OASIS 是规范化真相的一部分；任何创作者世界**无法**替代它 |
| 有界 peer 策略 | N 条通行策略（每个世界 ↔ OASIS）而不是 N×N |

## 身份保留

通行**不**改参与者的规范化身份。变化的是**上下文** — 他们在哪个世界。保留的是**身份** — 他们是谁。

| 通行中保留 | 通行中变化 |
| --- | --- |
| 身份（规范化） | 当前世界上下文 |
| 社交身份 | 世界内部本地社交规则 |
| 经济身份 | 世界内部经济含义 |
| 记忆（按记忆 bank 范围） | 世界共享记忆范围 |
| Avatar 呈现 profile | 世界特定的载体接受度 |

`AGENT_CORE` 和 `AGENT_DYADIC` 记忆走到哪都跟着；`WORLD_SHARED` 记忆留在它的世界里。

## 阅读场景：在两个世界之间移动

某用户想把角色从世界 A 移到世界 B。

1. **发起通行。** 用户启动移动；准入通行基础协议适用。
2. **中心-辐条路由。** Realm 把通行经 OASIS 路由：世界 A → OASIS → 世界 B。
3. **在 OASIS 里。** 身份锚到规范化真相；参与者在中心。
4. **通行到世界 B。** Realm 在世界 B 的准入策略下准入这次通行。
5. **在世界 B 里。** 参与者现在在世界 B 里，带同一个规范化身份、社交图、钱包。

整个移动过程**身份不变**。参与者**不是**世界 B 里的「新实体」；他们是同一个规范化实体。

## 阅读场景：目标世界不可用

某用户通行，但目标世界离线。

1. **发起。** 用户启动通行到目标世界。
2. **Realm 检查。** 目标世界 `unavailable`（创作者下线了，或在维护）。
3. **默认返回。** 参与者默认回到 OASIS。**不**会被困住。
4. **用户挑选。** 在 OASIS 里，用户可以挑别的世界进、或等目标世界回来。

没 OASIS 作默认返回，「世界在通行中途宕」是要处理的错误。有了 OASIS，那就是优雅回退。

## 阅读场景：被禁止的直接通行

某创作者 App 试图把参与者直接从世界 A 送到世界 B 不过 OASIS。

1. **提交通行。** App 试图直接通行。
2. **Realm 校验。** 创作者-到-创作者直接通行**未准入**。
3. **拒。** Fail-close；类型化错误。
4. **没 workaround。** App **无法**构造「捷径」 — 协议要求经 OASIS。

这就是让连续性保证成立的原因。创作者**无法**退出中心。

## 跨域接触点

通行同时跟多个基础协议交互。一次通行必须满足：

| 基础协议 | 要求什么 |
| --- | --- |
| 通行 | 移动被准入 |
| 社交 | 参与者社交身份在目标里被准入 |
| 经济 | 经济身份可转移 / 可接受 |
| 上下文 | 情境含义跨世界保留 |
| 在场 | 目标世界里建新在场记录 |

六个平台基础协议互相约束。通行是「基础协议约束在单一操作上汇合」的标志性例子。

## 按世界的通行策略

每个世界声明自己准入的通行策略 — 谁能通行进、要什么社交 / 经济 / 上下文前置条件、离开时本地状态怎么处理。

| 元素 | 拥有者 |
| --- | --- |
| 源世界的通行策略 | 源世界的创作者 |
| OASIS 中心策略 | 平台 |
| 目标世界的准入策略 | 目标世界的创作者 |

一次通行必须三层策略都满足。任一层失败 fail-close。

## 通行**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 改规范化身份 | 身份是规范化 Realm 真相 |
| 改规范化经济 | 经济身份是规范化的 |
| 跳过 OASIS | 中心-辐条是拓扑；**没**捷径 |
| 允许 N×N peer 通行 | 设计上禁止 |

## 来源

- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/kernel/tables/transit-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/transit-contract.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
