# 聊天

桌面端的聊天是统一的对话面，覆盖三种宿主形态：**人**、**AI**、**Agent**。同一套 UI 外壳，三种对话形态：你与他人交谈、你与通用 AI 助手交谈、你与某个 Nimi Agent 交谈。

## 三种宿主形态

| 形态 | 对方 | 权威 |
| --- | --- | --- |
| Human | 另一位用户 | Realm 聊天线程 |
| AI | 通用 AI 助手 | Runtime（经 SDK） |
| Agent | 某个具体的 Nimi Agent | Runtime + ConversationAnchor |

形态决定聊天外壳显示什么：目标侧边栏（找谁）、规范化对话外壳、转录区、输入器。

## 实时投递

聊天事件通过 Socket.IO 实时同步：新消息、正在输入、在线状态、已读状态都以实时事件下发，不靠轮询。聊天用的是已准入的实时通道，不会自造协议。

## 流式聊天

当对话目标是 AI 或 Agent 时，助手消息按流式契约从 Runtime 流出。

| 维度 | 取值 |
| --- | --- |
| 模式 | Mode A（文本/语音，结尾帧带显式 `done=true`） |
| 气泡渲染 | 边收到分片边渲染 |
| 中途停止 | 流式期间可用 |
| 部分内容 | 中断时保留 |
| 反压 | SDK 端到端 |

用户在流式中点"停止"，已经收到的部分会保留下来，下一轮交互从干净状态开始。

## 一轮对话的 hook 点

桌面端聊天暴露已准入的 hook 点，供 Mod 在每个阶段挂钩：

| Hook 点 | 触发时机 |
| --- | --- |
| `pre-policy` | 策略判定生效前 |
| `pre-model` | 模型调用前 |
| `post-state` | 状态更新后 |
| `pre-commit` | 提交前 |

注册到这些 hook 的 Mod（在白名单范围内）获取强类型事件。自由形态的拦截不准入，能挂的就是这几个点。

## 场景：和 Agent 聊天

你打开聊天，把目标选为自己的 Agent，开始输入。

1. **选定目标**。把 Agent 选为聊天目标。对话外壳为 `(your_agent_id, this_conversation_id)` 解出对应的 `ConversationAnchor`。
2. **输入**。输入器按强类型输入形态显示。
3. **发送**。这一轮被提交。Runtime 的 `RuntimeAgentService` 在 Agent 的 Chat Track 下接受这一轮。
4. **流式开始**。助手气泡按 Mode A 分片增量呈现。
5. **中途停止**。你点了停止。流式契约保留了已收到的部分。
6. **写入 Realm 聊天线程**。这一轮记入规范化的聊天线程：Realm `R-CHAT-*`。

Agent 身份是 Realm 的规范态；对话连续性归 Runtime 的 anchor；流式语义是已准入契约；线程是规范化聊天历史。

## 场景：群聊里有 Agent 槽位

你在一个 Realm 群聊里，里面有人也有 Agent 槽位。

1. **群组线程**。Realm `R-CHAT-*` 准入 `GROUP` 形态。
2. **Agent 作者校验**。Agent 发言时，Realm 校验它的槽位绑定。反假冒检查在消息提交前发生。
3. **看到强类型作者**。人无法假冒 Agent；Agent 也不能在它的槽位之外发言。
4. **Agent 消息流式**。Agent 的回复以流式形态流入群组线程。

反假冒检查在协议层。如果有人尝试以"Agent 名义"发言但没有槽位绑定，会因校验失败而被拒绝。

## 桌面端聊天不做的事

| 关注点 | 归属 |
| --- | --- |
| 具身化 / 形象呈现 | Avatar 应用——桌面端聊天不再做 Live2D / VRM 的承载面 |
| 记忆权威 | Cognition + Runtime 记忆库作用域 |
| 规范化线程 | Realm 聊天 |
| 一轮执行权威 | Runtime Agent 服务 |
| 流式语义 | Runtime 流式契约 |

如果用户想要具身化，他们去 Avatar。桌面端聊天可以呈现非承载性的提示（例如表情指示），但不再是 Live2D / VRM 的承载面。

## 来源依据

- [`.nimi/spec/desktop/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/chat.md)
- [`.nimi/spec/realm/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/chat.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/desktop/kernel/streaming-consumption-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/streaming-consumption-contract.md)
- [`.nimi/spec/desktop/kernel/conversation-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/conversation-capability-contract.md)
