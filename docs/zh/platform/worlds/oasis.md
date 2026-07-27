# OASIS

OASIS 是 Nimi 里唯一的系统主世界。它是规范化真相的一部分，正式定义在规范里，任何 App 习惯都不能取代它。

## OASIS 是什么

| 属性 | 取值 |
| --- | --- |
| 身份 | 唯一的系统主世界 |
| 权威 | Realm 规范化真相的一部分 |
| 归属 | 不属于任何创作者 |
| 可替换性 | 不能被 App 习惯取代 |
| 角色 | 默认回归点；世界之间转场的唯一中枢 |
| 读取面 | `GET /api/world/oasis` 是一份正式的真相读取 |

OASIS 不是品牌，不是「演示世界」，也不是创作者可以克隆或越过的新手区。它是平台规范模型的组成部分。

## OASIS 为什么存在

多数跨世界平台要么回避中枢这个问题，要么用一种非正式方式解决：靠 App 习惯定一个「主大厅」，世界之间随意 P2P 互联。Nimi 走的是相反的路。

两个设计性质依赖 OASIS：

- **单跳连续性协议**。创作者世界之间不能直接 P2P 转场。转场都要经 OASIS：World A → OASIS → World B。这让「跨世界上下文切换时身份的连续性」成为真实保证，而不是实现里的偶然。
- **默认回归点**。参与者从创作者世界离开时，回到的就是 OASIS。这意味着平台始终有一个规范化的去处，不必依赖任何单一创作者世界的可达性。

合起来看，OASIS 是平台连续性的脊椎 —— 它让身份、社交关系、经济地位在跨创作者世界时仍保持意义。

## OASIS 与其他「元宇宙中枢」的差别

《Ready Player One》里的 OASIS 是单一共享物理世界模拟。Nimi 借的是「意义中枢」这个想法，但实质上是一台**社会与语义引擎**，不是物理引擎。

| 属性 | 元宇宙式中枢 | Nimi OASIS |
| --- | --- | --- |
| 底盘 | 物理模拟 | 语义 + 社交真相 |
| 规则 | 全部世界继承 | 每个世界自己写内部规则 |
| 跨世界身份 | 经常是继承式的 | 一等的平台真相 |
| 中枢的权威 | 通常是某家公司 | 平台级规范模型 |
| 是否可替换 | 有时可以 | 不可替换，OASIS 是规范化真相 |

Nimi 的 OASIS 是转场中枢与连续性锚点，不是共享物理舞台。世界内部的规则由创作者撰写，跨世界的部分走六项基础协议。

## 场景：参与者在两个世界之间移动

某用户在 World A，想去访 World B。

1. 用户发起转场。Transit 基础协议契约管控这次移动。
2. 系统把它路由经 OASIS：World A → OASIS → World B。没有直接的创作者世界间转场。
3. 转场过程中，参与者的身份保持规范化；任何世界都不允许悄悄给他造一个新身份。
4. World B 在它的本地规则下准入这位参与者。还是同一个人，带着同一份社交关系和钱包。

为什么走 OASIS？因为 OASIS 是规范化真相。世界之间直接转场会构造出 N×N 的对等连接策略；中枢式设计把这个换成 N 条策略（每个世界与 OASIS 的契约）。

## 场景：世界下线时的默认回归

假设用户所在的世界被创作者下线。

- 没有中枢：参与者被搁置，平台没有规范化的去处把他送过去。
- 有 OASIS：参与者自动回到 OASIS。身份与标识不受影响。他可以再挑别的世界进去。

中枢不仅是出发点，它还让多世界平台对任意单一世界的可达性具备健壮性。

## 场景：创作者不能取代 OASIS

假设某创作者想把自己的「主世界」做出来，让自己旗下的内容都从这里转场。

- 他完全可以做出一个流行的世界。创作者世界是一等公民。
- 他不能取代 OASIS。平台的转场协议按设计走 OASIS；创作者世界承担不了这个角色。
- 他不能让 OASIS 变成可选项。直接的创作者间转场不在平台协议的准入范围内。

不可替换正是这件事的要点。如果 OASIS 可被品牌替换，连续性保证也就跟着可被替换。

## 来源依据

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
