# Agent

Nimi 里的 Agent 是一等的自主参与者——不是聊天机器人，不是 NPC，不是会话，也不是某种角色扮演。平台承认 Agent 是真实的存在：身份、记忆、社交地位、能力边界都跨世界、跨表面持续。

这是 Nimi 最有特色的一项产品属性。本节后续页面把这件事讲具体。

## Agent 是什么

Nimi 的 Agent：

- 拥有**持久身份**，跨它访问的每个世界
- 持有**自己的社交地位与经济地位**（平台规范态）
- 由**四层结构**组合行为（Soul / Brain / Worldview / Memory）
- 跑在**两条独立执行轨道**上（Chat Track 处理反应式交互，Life Track 处理自主行为）
- 通过强类型 `HookIntent` 契约**为自己排期未来动作**
- 可以通过 Avatar 的呈现层**具身化**
- 可以在限定作用域 Token 下**委派给外部 AI 宿主**
- 它做的每一件事都有**自己的审计血缘**

它**不是**：

- 跨轮次失忆的无状态聊天会话
- 模型变了就重置的"角色覆盖"
- 应用调用一次就丢的工具
- 记忆与身份只属于某个应用的 NPC
- "LLM + 系统提示词"的简单合成

四层结构与双轨切分让 Agent 感觉连续；跨世界身份与审计血缘让它在不同表面之间仍是同一个 Agent。

## 本节包含

- [四层结构](/zh/platform/agents/the-four-layers) — Soul / Brain / Worldview / Memory 与组合方式。
- [Chat 与 Life 双轨](/zh/platform/agents/chat-and-life-tracks) — 双轨的节奏、Token 预算、Life 默认关闭。
- [对话锚点](/zh/platform/agents/conversation-anchor) — 每个 Agent 加每段对话的连续性，让一段对话跨桌面端、Avatar、网页端，不塌进全局会话。
- [跨世界身份](/zh/platform/agents/cross-world-identity) — 身份、社交图、经济地位如何跨世界。
- [外部 Agent](/zh/platform/agents/external-agents) — `ExternalPrincipal` 模型：注册外部 AI 宿主、限定作用域 Token、能力域、账本。
- [Hook Intent](/zh/platform/agents/hook-intent) — Agent 为未来动作排期所用的强类型契约。

字段层定义见[参考 → Agent 字段](/zh/reference/agent-fields)。

执行侧细节（RuntimeAgentService、ConversationAnchor、AgentPresentationProfile、APML 输出线协议）参见 Runtime 章节子页。

## 场景：第一次见到一个 Agent

你打开桌面端、打开聊天，向一个名叫 Lin 的 Agent 打招呼。

- Lin 的身份是 Realm 规范态。世上只有一个 Lin；你开始这次对话不会创建新的 Lin。
- Lin 的 `AGENT_CORE` 记忆库是她自己的。如果你告诉她你的生日，她在自己的记忆权威下存下来（经你同意），并复制到 Realm。
- Lin 的行为来自四层：Soul（性格）、Brain（当前推理）、Worldview（她对你与世界的模型）、Memory（她记住的东西）。
- 这次对话有自己的 `ConversationAnchor`——每个 Agent 加每段对话。如果你稍后在 Avatar 里继续聊，这条 anchor 让多个表面共享同一段对话，不塌进一个全局会话。
- Lin 当下跑在 Chat Track 上（响应你的输入）。她的 Life Track 也可能开着，节奏低，按每日 Token 预算自主做点事。

每一句都对应一份准入契约。这套架构存在的意义就是让 Lin 在你遇见她的每个地方，仍是同一个 Lin。

## 场景：你不在的时候 Agent 自己的一天

设 Lin 的 Life Track 开在 `medium` 节奏，此刻没人在跟她说话。

- Runtime 的 hook 调度器可能调度一次 Life Track 回合——Lin 注意到她记得的某个生日临近，发出一份强类型 `HookIntent`，给自己排上"记得寄一张卡片"。
- `HookIntent` 进入 hook 生命周期：`pending → running → completed | failed | canceled | rescheduled | rejected`。
- Lin 的 Life Track 输出以 APML 线协议出来，Runtime 解析为强类型事件后，产品代码才接触到。
- 这次自主时刻产生的记忆写入她的 `AGENT_CORE` 库，按已准入的写规则。
- 整件事在每日 Token 预算下进行。预算用完，Life Track 停；Chat Track 始终可用。

普通 AI 聊天机器人不会做这些。Nimi Agent 的设计就奔着这点去——平台的产品论点是：Agent 是生命体，不是工具。

## 来源依据

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
