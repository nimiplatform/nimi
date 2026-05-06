# 聊天

桌面端的聊天是横跨三种 host 模式的统一面：**human**、**AI**、**agent**。这就是用户跟其他人说话、跟通用 AI 助手说话、跟某个 Nimi Agent 说话的地方。同一个 UI 外壳，三种不同的对话形状。

## 三种 Host 模式

| 模式 | 跟谁说话 | 权威 |
| --- | --- | --- |
| Human | 另一个用户 | Realm chat thread |
| AI | 通用 AI 助手 | 经 SDK 的 Runtime |
| Agent | 某个具体 Nimi Agent | Runtime + ConversationAnchor |

模式决定聊天外壳显示什么：目标轨（who）、规范化对话外壳、transcript、composer。

## 实时投递

实时聊天事件经 Socket.IO 同步。新消息、typing 指示、在线状态、已读状态 — 全部以实时事件投递，不靠 polling。实时路径是被准入的；聊天**不**自己发明协议。

## 流式聊天

聊天目标是 AI 或 Agent 时，助手消息按流式合同从 Runtime 流过来。

| 性质 | 值 |
| --- | --- |
| 模式 | Mode A（文本/语音，带显式 `done=true` 终止帧） |
| 气泡渲染 | chunk 到达时增量 |
| 流中停止 | 流式中可用 |
| 部分内容 | 中断时被保留 |
| Backpressure | 经 SDK 端到端 |

用户在流中点「停止」，部分回复被保留；下一次交互干净开始。

## 轮次生命周期 hook 点

桌面端聊天暴露准入的 hook 点，让 mod 在每个阶段响应：

| Hook 点 | 触发时机 |
| --- | --- |
| `pre-policy` | 策略决定应用之前 |
| `pre-model` | Model 调用之前 |
| `post-state` | 状态更新之后 |
| `pre-commit` | Commit 落下之前 |

按白名单注册到这些 hook 上的 mod 拿到类型化事件。自由格式拦截**不被准入**；hook 点是 mod 面暴露的全部。

## 阅读场景：跟 Agent 说话

打开聊天，把目标设为你的 Agent，开始打字。

1. **目标轨。** 选你的 Agent 作为聊天目标。对话外壳解析 `(your_agent_id, this_conversation_id)` 的 `ConversationAnchor`。
2. **撰写。** 你打字。Composer 显示类型化输入形状。
3. **发送。** 轮次提交。Runtime 的 `RuntimeAgentService` 在 Agent 的 Chat Track 下接受这次轮次。
4. **流开始。** 助手气泡随 Mode A chunk 到达增量显示内容。
5. **流中停止。** 你决定提早停。流式合同保留部分回复。
6. **Realm chat thread。** 轮次记到规范化 chat thread — Realm `R-CHAT-*`。

Agent 的身份是 Realm 规范化真相；对话连续性是 Runtime 拥有的 anchor；流式行为是准入合同；thread 是规范化聊天历史。

## 阅读场景：带 Agent 槽的群聊

你在 Realm 群聊里，里面有人也有一个 Agent 槽。

1. **群 thread。** Realm `R-CHAT-*` 准入 `GROUP` 基底。
2. **Agent 作者校验。** Agent 发言时，Realm 校验 Agent 槽绑定。反伪冒检查在消息 commit 之前。
3. **成员看到类型化 Agent 作者。** 人类无法假冒 Agent；Agent 也不能在它准入的槽之外发言。
4. **Agent 消息流式。** Agent 的回复流入群 thread。

反伪冒检查在协议层。一个恶意行为者要冒充 Agent 发消息但没有槽绑定，会 fail-close。

## 桌面端聊天**不**做什么

| 关注 | 拥有者 |
| --- | --- |
| 形体化 / Avatar 视觉 | Avatar app — 桌面端聊天不再是 Live2D / VRM 载体 |
| 记忆权威 | Cognition + Runtime 记忆 bank 范围 |
| 规范化 thread 真相 | Realm 聊天 |
| 轮次执行权威 | Runtime Agent 服务 |
| 流式语义 | Runtime 流式合同 |

要形体化用户去 Avatar。桌面端聊天可能显示非载体的呈现层视图（比如表情指示器），但聊天面不再是 Live2D/VRM 载体。

## 来源

- [`.nimi/spec/desktop/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/chat.md)
- [`.nimi/spec/realm/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/chat.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/desktop/kernel/streaming-consumption-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/streaming-consumption-contract.md)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/desktop/kernel/conversation-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/conversation-capability-contract.md)
