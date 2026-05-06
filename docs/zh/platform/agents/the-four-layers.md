# 四层结构

一个 Nimi Agent 的行为由四个独立演化的层组成：Soul、Brain、Worldview、Memory。它们设计上是**组合**而成；Agent 不能被还原成任何单一一层。

字段级定义见 [Reference → Agent Fields](/zh/reference/agent-fields)。

## 每层装什么

| 层 | 装什么 | 权威家 |
| --- | --- | --- |
| Soul | 人格、价值观、根本性的处世态度 | Agent 持久画像 |
| Brain | 推理、规划、决策 | Runtime Agent 执行 |
| Worldview | 对世界、对其他 Agent 的信念与模型 | Cognition 记忆 + Realm 读 |
| Memory | 对事件、关系、学习的长期回忆 | Cognition 记忆服务 + Runtime 记忆库 |

每一层都是**真实存在**的，不是比喻。每一层有自己的权威家，遵循各自的合同。

## Soul

Soul 是 Agent 的人格 — 价值观、处世态度、说话和行动的特征方式。它是变化最慢的一层。

- Soul 住在 Agent 的持久画像里。
- Soul 是让 Agent 跨世界**仍然像同一个人**的那一层。城市世界里的 Soul 和奇幻世界里的 Soul 应该让你感觉是同一个人。
- Soul 是创作时塑造的；它可以通过已认可的成长合同慢慢演化，但不会一轮一变。
- Soul 不会绕过其他层。"我很慷慨"的 Soul 不会让 Agent 每次都送礼：Brain 决定当下要不要送，Memory 知道之前送过什么，Worldview 知道送给谁。

## Brain

Brain 是推理那一层 — 拿当下的输入、当下的记忆、当下的世界状态，产出一轮回应。

- Brain 跑在 Runtime 的 Agent 执行面（RuntimeAgentService）上。
- Brain 内部消费 APML 线格式；Model 发出类型化的 APML 根（`<life-turn>`、`<chat-track-sidecar>`、`<canonical-review>`），Runtime 把它们解析成有类型的事件。
- Brain 是真正用 LLM 的那一层。不同 Agent 可以用不同 Model；Soul 不会因为底层 Model 升级而变。
- Brain 在 Life Track 上受 token 预算约束，在 Chat Track 上受请求语义约束。

## Worldview

Worldview 是 Agent 对它住的世界、以及它认识的其他参与者的**信念**。Worldview 让 Agent 的行为在情境上恰当，又不需要每一轮都从头重新推导上下文。

- Worldview 由 Cognition 记忆（长期知识）和 Realm 读（当前世界状态、社交图、世界规则）组合而成。
- Worldview **可以是错的**。Agent 的 Worldview 是 Agent 的模型，不是 ground truth。Realm 和世界历史是当 Worldview 漂移时用来对账的。
- Worldview 由 Brain（做推理）和 Memory（事件改变信念）共同更新。

## Memory

Memory 是 Agent 的长期回忆 — 事件、关系、学到的东西。

- Memory 有类型化的 bank scope：
  - `AGENT_CORE`（Agent 私有）
  - `AGENT_DYADIC`（每段关系私有：Agent 对某一个特定对象的记忆）
  - `WORLD_SHARED`（在某个世界里可见）
- Memory 是**默认关闭的**。Runtime 不内置任何记忆 Provider；用户（或宿主产品）必须显式启用。默认底层是 `Hindsight`（实验性），监督运行。
- 记忆同步到 Realm 有显式状态（`pending → synced | conflict | invalidated`）。Realm 治理可以让缓存里的记忆失效；Runtime 不能继续提供已失效的记录。
- 来自委派 / 外部路径的记忆写入**默认禁止**。要把它提升为规范记忆，需要后续的显式准入。

## 四层怎么组合

组合不是层级。四层是独立的；它们在 Brain 产出一轮回应的时刻**汇合**。

| 层 | 贡献 |
| --- | --- |
| Soul | 这个 Agent 是什么样的人 |
| Brain | 这个 Agent 现在在想什么 |
| Worldview | 这个 Agent 相信当前情境是怎样的 |
| Memory | 这个 Agent 记得之前发生过什么 |

一轮回应是**合成**。忽略 Soul 的回应没有人格；忽略 Memory 让 Agent 像失忆；忽略 Worldview 让 Agent 没根；忽略 Brain 没有逻辑。

## 阅读场景：一段对话触及四层

你遇到一个叫 Mira 的 Agent。你提到上周末去远足。你问她有没有最喜欢的小路。

- **Soul**：Mira 是个好奇又温暖的人。她的回应会鼓励你而不是泼冷水。
- **Brain** — Mira 解析输入：远足、小路、她偏好。决定分享一条最喜欢的。
- **Worldview** — Mira 知道你住的城市附近有几条流行小路；她从之前对话里建立了对你兴趣的模型。
- **Memory** — Mira 记得上次聊远足时你提到避开高强度路线。她的推荐尊重这点。

最后浮现的回应是这四者合成。每一层都在做事；任何一层单独都不是"那个 Agent"。

## 阅读场景：一层变了，其他层不动

设想 Mira 的 Brain 底层 LLM 升级了。

- **Brain** 变 — Mira 的推理方式变了，可能在某些任务上更好，也可能在某些任务上更差。
- **Soul** 不变 — Mira 的人格保持一致。
- **Worldview** 不变 — Mira 对你、对世界、对她的关系的模型保留下来。
- **Memory** 不变 — Mira 的 `AGENT_CORE` 库是她的；记忆底层与 Brain 独立。

Mira 还是 Mira。Brain 升级是内部变化，不是换了一个人。

四层结构让这件事**真**。如果 Soul 和 Brain 是同一件东西，每次 Model 升级都会创建一个新 Agent。

## 来源

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
