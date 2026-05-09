# Agent 执行

## 状态：现在 (Running today)

RuntimeAgentService 是已交付的 Agent 执行权威。

`RuntimeAgentService` 是 Runtime 持有的 Agent 执行权威。它持有多 Agent 生命周期、对话连续性、Chat / Life 双轨模型、hook 调度、记忆写入准入和呈现改写。

本页是产品叙述 [平台 → Agents](/zh/platform/agents/) 的运行时一面。Agent 的产品定义在那边，本页讲 Runtime 这一侧的归属。

## RuntimeAgentService 持有什么

| 责任 | 表面 |
| --- | --- |
| 多 Agent 生命周期 | 并发的 `agent_id` 生命周期 |
| 对话连续性 | 每个 Agent + 每场对话一份 `ConversationAnchor` |
| Chat / Life 双轨执行 | 反应式 + 主动式调度 |
| Hook 调度 | 强类型 `HookIntent` 的准入与派发 |
| 记忆写入准入 | 受准入的记忆契约约束 |
| 呈现改写 | 持久画像 + 临时流 |
| APML 输出解析 | 从 APML 线上格式得到强类型事件 |

平台**不存在默认当前 Agent**。Runtime 同时托管多个 `agent_id` 生命周期，应用或表面自己挑要交互的 Agent。

## ConversationAnchor

对话锚点是 Runtime 持有的连续性身份。多个表面共用**同一场**对话时，靠它来让对话不退化成全局会话。

| 属性 | 取值 |
| --- | --- |
| 作用域 | 每个 Agent + 每场对话 |
| 持有方 | Runtime |
| 持久性 | 跨表面切换仍在（桌面端聊天 → Avatar → 网页端） |
| 多重性 | 一个 Agent 可有多个锚点（多场并行对话） |

产品角度的说明见 [平台 → Agents → Conversation Anchor](/zh/platform/agents/conversation-anchor)。

## AgentPresentationProfile

持久呈现画像是 Runtime 持有、变化缓慢的 Agent 呈现真相：

| 字段 | 用途 |
| --- | --- |
| Avatar 后端 | Live2D / VRM / generated-motion |
| 资产引用 | 与具体载体绑定的资产 |
| 表情预设 | 默认表情行为 |
| 声音绑定 | 声音画像引用 |

画像跨 Runtime 重启仍在，跨表面也能复用。Avatar 消费它，但不能重新定义它。

## Agent Presentation Stream

呈现流和持久画像不同，是一条临时改写通道：回合改写、当前情绪改写、流提交语义。Avatar 在具身表面上一回合一回合消费的就是它。

| 持有方 | Runtime |
| --- | --- |
| 回合改写 | `runtime.agent.turn.*` |
| 活动事件 | `runtime.agent.activity.*` |
| 姿态事件 | `runtime.agent.pose.*` |
| 口型帧 | `runtime.agent.lipsync.*` |

## APML 输出线上格式

Agent 输出面向模型的契约是 **APML**（Agent Personality Markup Language）。

| 根标签 | 用途 |
| --- | --- |
| `<life-turn>` | 主动式 life 轨道输出 |
| `<chat-track-sidecar>` | 反应式 chat 轨道边带 |
| `<canonical-review>` | 用于记忆准入的规范化复核输出 |

JSON 执行器兼容**未被准入**。APML 必须先在 Runtime 解析、改写为强类型事件，产品代码才会看到。应用消费的是这些强类型事件，不是裸 APML。

这是有意为之：模型给出结构化的 Agent 输出，Runtime 校验结构，产品代码拿到的是强类型事件，从结构上无法编码出 Runtime 没准入的形态。

## Hook Intent 准入

Agent 通过强类型 `HookIntent` 记录请求未来的定时动作，而不是写一段自由格式的调度字符串。Runtime 校验后准入。

| 生命周期状态 | 含义 |
| --- | --- |
| `pending` | 已准入，等待触发 |
| `running` | 正在执行 |
| `completed` | 成功终态 |
| `failed` | 失败终态 |
| `canceled` | 完成前取消 |
| `rescheduled` | 改到新时间，回到 `pending` |
| `rejected` | 准入阶段被拒 |

产品角度的说明见 [平台 → Agents → Hook Intent](/zh/platform/agents/hook-intent)。

## 默认多 Agent

Runtime 同时托管多个 `agent_id` 生命周期。应用想和某个 Agent 交互，就要给出 `agent_id`，Runtime 不替它假设。

| 并发 | 细节 |
| --- | --- |
| 每 Agent 状态 | 各自有独立的锚点集合、hook 调度器、呈现画像 |
| 每对话状态 | 每场对话各持一个锚点 |
| 跨 Agent 隔离 | 记忆库作用域（`AGENT_CORE` / `AGENT_DYADIC`）让各自的私有状态彼此不可读 |
| 并发执行 | 多个 Agent 可在 Runtime 预算内并行跑 Chat 或 Life |

## 读者场景：一个表面里两个 Agent

某用户在同一个桌面端窗口里挂了两个 Agent，比如一个项目助手加一个个人助手。两位都能并发动作。

1. **各自独立生命周期。** Runtime 分别跟踪两个 `agent_id`。
2. **各自独立锚点。** 用户和这两位的对话是分开的。
3. **各自独立 life 轨道。** 都能独立开启 life，token 预算不互相分摊。
4. **记忆按作用域隔。** 每位的 `AGENT_CORE` 是私有的，互相看不见对方私有记忆。
5. **审计链路** 保留每个动作出自哪位 Agent。

同一用户下两个 Agent，默认不共享状态。

## 读者场景：对话锚点扛过了崩溃

用户正在 Avatar 里对话，Avatar 崩了。

1. **锚点存在于 Runtime。** 不在 Avatar，也不在桌面端。
2. **用户重启 Avatar。** Avatar 重连 Runtime。
3. **锚点解析。** Avatar 解析同一组 `(agent_id, conversation_id)`，锚点还在。
4. **对话恢复。** Realm 聊天线程保留消息，途中正在写的记忆按复制状态推进。

锚点归 Runtime 所有，这正是表面崩溃可以扛过去的根因。

## 来源依据

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
