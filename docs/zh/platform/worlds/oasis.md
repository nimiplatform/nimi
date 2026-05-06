# OASIS

OASIS 是 Nimi 里**唯一的系统主世界**。它是规范真相的一部分，被正式规定，**不能**被任何 App 习惯替换。

## OASIS 是什么

| 属性 | 值 |
| --- | --- |
| 状态 | 唯一的系统主世界 |
| 权威 | 规范 Realm 真相的一部分 |
| 所有权 | **不能**被任何创作者拥有 |
| 可替换性 | **不能**被 App 习惯替换 |
| 角色 | 默认返回点和世界之间唯一的跨越中枢 |
| 读面 | `GET /api/world/oasis` 是一次正式真相读 |

OASIS **不是**一个品牌。**不是**「demo 世界」。**不是**创作者可以克隆或盖过的教程区。它是平台规范模型的一部分。

## 为什么有 OASIS

大多数跨世界平台要么跳过中枢问题，要么非正式地解决 — 有个 App 习惯里的"主大厅"，世界之间随心对等连接。Nimi 走相反的路。

两条设计性质依赖 OASIS：

- **单跳连续协议**。创作者世界**不能**直接对等跨越到其他创作者世界。跨越走 OASIS：World A → OASIS → World B。这就是让"世界上下文变化下的身份连续性"成为真保证的原因，不是实现的偶然结果。
- **默认返回点**。当参与者离开一个创作者世界时，OASIS 是他们返回的地方。也就是说总有一个规范地方，平台可以把人路由过去，**不依赖**任何单个创作者的世界在线。

合起来，OASIS 是平台的连续性脊梁 — 让身份、社交图、经济地位跨创作者世界保持含义的那个东西。

## OASIS 跟其他元宇宙中枢的对比

《Ready Player One》里的 OASIS 是单一共享的物理世界仿真。Nimi 的 OASIS 借用了"含义中枢"的想法，但它是**社会与语义引擎**而不是物理引擎。

| 性质 | OASIS-style 元宇宙中枢 | Nimi OASIS |
| --- | --- | --- |
| 底层 | 物理仿真 | 语义 + 社交真相 |
| 规则 | 所有世界继承 | 每个世界自己写内部规则 |
| 跨世界身份 | 通常继承 | 一等的平台真相 |
| 中枢权威 | 通常是一家公司 | 平台层规范模型 |
| 品牌可替换 | 有时可以 | 不行 — OASIS 是规范真相的一部分 |

Nimi 的 OASIS 是跨越中枢和连续性锚点，**不**是共享的物理竞技场。世界内部规则由世界创作者写；跨世界的部分走六个基础协议。

## 阅读场景：参与者在两个世界之间移动

World A 里的用户想访问 World B。

1. 用户发起跨越。Transit 基础协议合同管这次移动。
2. 系统把这次移动路由通过 OASIS：World A → OASIS → World B。**不存在**直接的创作者世界到创作者世界的跨越。
3. 跨越中，参与者的身份保持规范；没有世界被允许无声地给他发明新身份。
4. World B 在自己的本地规则下接纳参与者。用户还是同一个人，带着在 World A 一样的友谊和钱包。

为什么走 OASIS？因为 OASIS 是规范真相的一部分。直接的世界-世界跨越会创造 N×N 的对等连接策略；OASIS 中枢设计把它替换成 N 个策略（每个世界跟 OASIS 之间的合同）。

## 阅读场景：世界下线时默认返回

设想用户所在的世界被创作者下线。

- 没有中枢：参与者被困住；平台没有规范的地方把他们路由过去。
- 有 OASIS：参与者自动回 OASIS。他们的身份和地位不受影响。可以选另一个世界进去。

中枢不只是发射点 — 它是让多世界平台对任何单个世界的可用性都鲁棒的关键。

## 阅读场景：创作者**不能**替换 OASIS

设想一个创作者想发自己的"主世界"，让他们所有内容的跨越都路由通过它。

- 他们当然能做出一个流行的世界。创作者世界是一等的。
- 他们**不能**替换 OASIS。平台的跨越协议按设计走 OASIS；创作者世界**不能**承担那个角色。
- 他们**不能**让 OASIS 变可选。直接的创作者-创作者跨越**不**在平台协议里被准入。

这种不可替换正是关键。如果 OASIS 是品牌可替换的，连续性保证也就是可替换的。

## 来源

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
