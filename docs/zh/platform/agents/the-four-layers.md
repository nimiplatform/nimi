# 四层结构

一个 Nimi Agent 的行为由四层独立演化的子层组成：Soul、Brain、Worldview、Memory。它们设计上是组合关系。Agent 不能还原成其中任何单独一层。

字段层面的定义见 [Reference → Agent Fields](/zh/reference/agent-fields)。

## 每一层承载的内容

| 层 | 承载 | 权威源 |
| --- | --- | --- |
| Soul | 性格、价值观、底层倾向 | Agent 的持久资料 |
| Brain | 推理、规划、决策 | Runtime 的 Agent 执行面 |
| Worldview | 对世界的信念、对其他 Agent 的模型 | Cognition memory + Realm 读取 |
| Memory | 事件、关系、习得的长期记忆 | Cognition memory 服务 + Runtime memory bank |

每一层都是真实的，不是比喻。每一层都有自己的权威归属，遵循各自的契约。

## Soul

Soul 是 Agent 的个性 —— 价值观、倾向、说话和行动的特征方式。它是变化最慢的一层。

- Soul 归在 Agent 的持久资料里。
- Soul 让 Agent 跨世界仍然可辨认。同一个 Soul 在城市世界与奇幻世界里，仍应让人觉得是同一个人。
- Soul 在 Agent 创建时由作者塑形；可以在准入的成长契约下随时间演进，但不会逐回合闪烁。
- Soul 不绕开其他层。Soul 写着「我慷慨」，并不意味着 Agent 时时在送礼物；当下是否送，由 Brain 决定，曾送过什么由 Memory 知道，送给谁由 Worldview 知道。

## Brain

Brain 是推理层 —— 接住当前输入、当前 Memory、当前世界状态，输出一个回合。

- Brain 跑在 Runtime 的 Agent 执行面（RuntimeAgentService）。
- Brain 内部消费 APML 输出线格式：模型输出强类型 APML 根（`<life-turn>`、`<chat-track-sidecar>`、`<canonical-review>`），由 Runtime 解析为强类型事件。
- Brain 是用到 LLM 能力的层。不同 Agent 可以用不同模型；底层模型升级时，Soul 不变。
- Brain 在生命轨迹上受 token 预算约束，在聊天轨迹上受请求语义约束。

## Worldview

Worldview 是 Agent 对所在世界、所识其他 Agent 的信念。它让 Agent 行为有上下文，不必每回合从头推一遍。

- Worldview 由 Cognition memory（长期知识）与 Realm 读取（当前世界状态、社交图、世界规则）共同组成。
- Worldview 可以错。它是 Agent 的模型，不是真理。Realm 与世界历史是 Worldview 与现实偏离时的对账方。
- Worldview 由 Brain（推断）与 Memory 写入（让 Agent 改变信念的事件）共同更新。

## Memory

Memory 是 Agent 的长期记忆 —— 事件、关系、习得。

- Memory 有强类型的 bank 作用域：
  - `AGENT_CORE`（Agent 私有）
  - `AGENT_DYADIC`（按关系私有 —— Agent 对某一另一个体的记忆）
  - `WORLD_SHARED`（在某个世界内可见）
- Memory 是按需启用的。Runtime 不预设 memory provider；用户（或宿主产品）必须自己启用。默认底盘是 `Hindsight`（实验性、受监督运行）。
- Memory 复制到 Realm 有显式状态：`pending → synced | conflict | invalidated`。Realm 治理可以让缓存中的 memory 失效；Runtime 不会继续基于失效记录提供服务。
- 来自 delegated 或外部路径的 Memory 写入默认禁止。要让其升格为规范化 memory，需要后续准入。

## 四层如何组合

组合不是层级。四层是独立的，它们在 Brain 输出回合的那一刻汇合。

| 层 | 贡献 |
| --- | --- |
| Soul | 这个 Agent 是什么样的人 |
| Brain | 这个 Agent 此刻在想什么 |
| Worldview | 这个 Agent 相信当下情况是什么样 |
| Memory | 这个 Agent 记得过去什么 |

回合是这一切的合成。忽略 Soul 的回合输出没性格；忽略 Memory 的回合让 Agent 像失忆者；忽略 Worldview 的回合脱离当下情境；忽略 Brain 的回合没有逻辑。

## 场景：一段对话动用四层

你遇到一个名叫 Mira 的 Agent。你提到上周末去爬山。你问她有没有最爱的徒步路线。

- **Soul**：Mira 好奇而温暖。她的回应会鼓励，而不是冷淡。
- **Brain**：Mira 解析你的输入：徒步、路线、想要她的偏好。她决定分享一条最爱。
- **Worldview**：Mira 知道你住在一座有几条热门路线的城市。她对你的兴趣有一个由先前对话累积起来的模型。
- **Memory**：Mira 想起上次聊到徒步时，你说过避开吃力路线。这一次的推荐会照顾这一点。

最终的回应是这一切的合成。每一层都在做事，没有任何一层单独就是「这个 Agent」。

## 场景：换 Brain 不动其他层

假设承载 Mira 的 Brain 的 LLM 升级了。

- **Brain** 变了：Mira 的推理方式变了，某些事更擅长，某些事可能变弱。
- **Soul** 不变：Mira 的性格保持稳定。
- **Worldview** 不变：她对你、世界、关系的模型仍在。
- **Memory** 不变：她的 `AGENT_CORE` bank 是她自己的；记忆底盘与 Brain 解耦。

Mira 还是 Mira。Brain 升级是内部改动，不是换了一个人。

四层结构让这件事在结构上为真。如果 Soul 与 Brain 是同一回事，每次模型升级都会造出一个新 Agent。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
