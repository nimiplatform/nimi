# Agent 执行

`RuntimeAgentService` 是 Runtime 一侧 Agent 执行的权威。它管多 Agent 生命周期、对话连续性、Chat / Life 双轨、Hook 调度、记忆写入准入、呈现层。

这页是 [Platform → Agents](/zh/platform/agents/) 产品叙事的 Runtime 侧补充。Agent 的产品框架在那边讲；这页讲 Runtime 拥有什么。

## RuntimeAgentService 拥有什么

| 职责 | 表面 |
| --- | --- |
| 多 Agent 生命周期 | 同一时刻并行的 `agent_id` 生命周期 |
| 对话连续性 | 每个 Agent + 每段对话各有 `ConversationAnchor` |
| Chat / Life 双轨执行 | 反应式 + 主动式调度 |
| Hook 调度 | 准入并派发类型化 `HookIntent` |
| 记忆写入准入 | 受准入的记忆合同约束 |
| 呈现层 | 持久 profile + 瞬时事件流 |
| APML 输出解析 | 把 APML 线协议解码为类型化事件 |

**没有所谓的"平台默认当前 Agent"**。Runtime 同时承载多个 `agent_id` 生命周期；要跟哪个 Agent 说话，由 App 或表面自己指定。

## ConversationAnchor

ConversationAnchor 是 Runtime 拥有的连续性身份，让多个表面共享**同一段对话**而不被合并成一个全局 session。

| 性质 | 值 |
| --- | --- |
| 范围 | 每个 Agent + 每段对话 |
| 所有者 | Runtime |
| 持久性 | 切换表面后仍然在（桌面端 chat → Avatar → 网页端） |
| 多重性 | 一个 Agent 可以有多个 anchor（多段并行对话） |

产品侧叙事见 [Platform → Agents → Conversation Anchor](/zh/platform/agents/conversation-anchor)。

## AgentPresentationProfile

持久呈现 profile 是 Runtime 拥有的、变化缓慢的「Agent 怎么呈现」真相：

| 字段 | 用途 |
| --- | --- |
| Avatar 后端 | Live2D / VRM / 生成式动作 |
| Asset 引用 | 载体特定的资源绑定 |
| 表情预设 | 默认表情行为 |
| 语音绑定 | 语音 profile 引用 |

Profile 跨 Runtime 重启与表面复用。Avatar 消费它；Avatar 不重新定义它。

## Agent Presentation Stream

跟持久 profile 不一样，**呈现事件流**是瞬时接缝：turn 事件、当前情绪事件、流式 commit 语义。Avatar 一轮一轮消费的是这个流。

| 所有者 | Runtime |
| --- | --- |
| Turn 事件 | `runtime.agent.turn.*` |
| 行动事件 | `runtime.agent.activity.*` |
| 姿态事件 | `runtime.agent.pose.*` |
| 口型帧 | `runtime.agent.lipsync.*` |

## APML 输出线协议

模型到 Runtime 的 Agent 输出合同叫 **APML**（Agent Personality Markup Language）。

| 根标签 | 用途 |
| --- | --- |
| `<life-turn>` | 主动 Life Track 输出 |
| `<chat-track-sidecar>` | 反应式 Chat Track 边路 |
| `<canonical-review>` | 记忆准入用的规范化 review |

JSON executor 兼容性**未准入**。APML 在被任何产品代码看到之前先被解析、再被投到类型化的 Runtime 事件上。App 消费的是类型化事件，不是原始 APML。

这是有意设计：模型负责发出结构化的 Agent 输出；Runtime 负责验证结构；产品代码拿到类型化事件，没法编码出 Runtime 没有准入的形状。

## Hook Intent 准入

Agent 想安排未来动作时通过类型化的 `HookIntent` 记录，不是自由文本。Runtime 验证并准入。

| 生命周期 | 含义 |
| --- | --- |
| `pending` | 已准入；等触发时刻 |
| `running` | 正在执行 |
| `completed` | 成功终态 |
| `failed` | 失败终态 |
| `canceled` | 终态前取消 |
| `rescheduled` | 改期；回到 `pending` |
| `rejected` | 准入时被拒 |

产品侧叙事见 [Platform → Agents → Hook Intent](/zh/platform/agents/hook-intent)。

## 多 Agent 是默认

Runtime 同时承载多个 `agent_id`。想跟某个 Agent 交互的 App 自己提供 `agent_id`；Runtime 不替它假设。

| 并发性 | 细节 |
| --- | --- |
| 每个 Agent 的状态 | 各自独立的 anchor 集合、Hook 调度器、呈现 profile |
| 每段对话的状态 | 每段对话各自独立的 anchor |
| Agent 间隔离 | `AGENT_CORE` / `AGENT_DYADIC` 记忆 bank 范围把 Agent 之间的私有状态隔开 |
| 并发执行 | 多个 Agent 在 Runtime 预算下可以并行跑 Chat 或 Life |

## 阅读场景：同一表面两个 Agent

用户在同一个桌面端窗口里有两个 Agent — 比如一个项目助手 + 一个个人助手。两个都能并发。

1. **各自有生命周期。** Runtime 独立追踪两个 `agent_id`。
2. **各自有 anchor。** 用户跟每一个分别有独立对话。
3. **各自有 Life Track。** 两个 Agent 可以独立开 Life；token 预算不混。
4. **记忆是有范围的。** 各自的 `AGENT_CORE` 私有；互相看不到对方的私有记忆。
5. **审计 lineage** 保留谁做了什么动作。

一个用户、两个 Agent、默认无共享状态。

## 阅读场景：表面崩了 Anchor 还在

用户在 Avatar 里跟某个 Agent 聊。Avatar 崩了。

1. **Anchor 在 Runtime 里。** 不在 Avatar、也不在桌面端。
2. **用户重开 Avatar。** Avatar 重新连接 Runtime。
3. **Anchor 解析。** Avatar 解析同一个 `(agent_id, conversation_id)`；anchor 还在。
4. **对话续上。** Realm 的 chat thread 保留消息；正在飞行中的记忆写入按 replication state 推进。

Anchor 归 Runtime 拥有，是表面失败可恢复的关键。

## 来源

- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml)
