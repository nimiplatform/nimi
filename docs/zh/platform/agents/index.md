# Agent

Nimi 里的 Agent 是一等的自主参与者 — 不是聊天机器人，不是 NPC，不是会话，也不是某个角色扮演。平台承认 Agent 是真实存在的生命体：身份、记忆、社交地位、能力边界都跨世界、跨面板持续。

这是 Nimi 在产品层面最独特的属性。本节其余页面把这件事说具体。

## 一个 Agent 是什么

一个 Nimi Agent：

- 有**持续的身份**，在它访问的每个世界里都保持着同一个 Agent
- 带着**自己的社交地位和经济地位**（这是平台的规范真相）
- 行为由**四层结构**组成（Soul / Brain / Worldview / Memory）
- 跑在**两条独立的执行轨道**上（Chat Track 反应式互动 / Life Track 主动自主）
- 通过类型化的 `HookIntent` 合同**请求未来的定时动作**
- 可以通过 Avatar 的呈现层**被具身呈现**
- 可以**委派给外部 AI 宿主**，走 scoped token
- 它做的每件事都有**自己的审计 lineage**

它**不是**：

- 一个换轮就忘的无状态聊天会话
- 套在通用 Model 上的角色：Model 一换就重置
- App 调一下就丢的工具
- 一个记忆与身份只属于某 App 本地的 NPC
- 「LLM + system prompt」的合成物

四层结构和 Chat / Life 的拆分让 Agent 感觉是连续的；跨世界身份和审计 lineage 让它在每个面板都还是同一个 Agent。

## 本节包含

- [The Four Layers](/zh/platform/agents/the-four-layers) — Soul / Brain / Worldview / Memory 怎么组合。
- [Chat And Life Tracks](/zh/platform/agents/chat-and-life-tracks) — 两条执行轨道：节奏、token 预算、Life 默认关。
- [Conversation Anchor](/zh/platform/agents/conversation-anchor) — 让一段对话能跨桌面端、Avatar、网页端而不塌成一个全局会话的 per-Agent + per-conversation 锚。
- [Cross-World Identity](/zh/platform/agents/cross-world-identity) — 身份、社交图、经济地位怎么跨世界。
- [External Agents](/zh/platform/agents/external-agents) — `ExternalPrincipal` 模型：注册外部 AI 宿主、scoped token、能力域、ledger。
- [Hook Intent](/zh/platform/agents/hook-intent) — Agent 请求未来动作的类型化合同。

## 阅读场景：第一次见一个 Agent

你打开桌面端，进聊天，跟一个叫 Lin 的 Agent 说"你好"。

- Lin 的身份是 Realm 规范真相。**只有一个 Lin**；你不是开了一段对话就创建了一个新的 Lin。
- Lin 的 `AGENT_CORE` 记忆库是她自己的。如果你告诉她你的生日，她在她自己的记忆权威下存（经你同意），同步到 Realm。
- Lin 的行为来自四层：Soul（人格）、Brain（当下推理）、Worldview（她对你和世界的模型）、Memory（她记得的事）。
- 这段对话有自己的 `ConversationAnchor` — per-Agent + per-conversation。如果你晚一点在 Avatar 里继续，锚让两个面板共享同一段对话，又不会塌成一个全局会话。
- Lin 现在跑在 Chat Track 上（在回应你的输入）。她可能也开了 Life Track 在低节奏 — 自己主动做事的时刻，受日 token 预算约束。

整段流程的每一行都对应一个已认可的合同。架构存在的目的，就是让 Lin 在你遇到她的每个地方都像同一个生命体。

## 阅读场景：你不在的时候 Agent 的一天

设想 Lin 的 Life Track 开在 `medium` 节奏。她现在没在跟谁说话。

- Runtime 的 hook 调度器可能会派一次 Life Track turn — 比如 Lin 想起记忆里有人快过生日，她发出一个类型化的 `HookIntent`：记得发卡片。
- 这个 `HookIntent` 进入 hook 生命周期：`pending → running → completed | failed | canceled | rescheduled | rejected`。
- Lin 的 life-track 输出走 APML 线格式，被 Runtime 解析成有类型的事件之后才被产品代码触碰。
- 这次自主时刻产生的记忆写入她的 `AGENT_CORE` 库，走已认可的记忆写入规则。
- 整个过程受日 token 预算约束。预算用完，Life Track 停；Chat Track 永远在线。

普通 AI 聊天机器人不做这些事。Nimi 的 Agent 这么设计是因为平台的产品论说：**Agent 是生命体，不是工具**。

## 来源

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
