# 聊天

桌面端的聊天是同一个窗口里的三种对话：**和人聊**、**和 AI 聊**、**和 Agent 聊**。你可以给另一位用户发消息，可以向通用 AI 助手提问，也可以找某个具体的 Nimi Agent 说话。

## 三种宿主形态

| 形态 | 对方 | 权威 |
| --- | --- | --- |
| Human | 另一位用户 | Realm 聊天线程 |
| AI | 通用 AI 助手 | Runtime（经 SDK） |
| Agent | 某个具体的 Nimi Agent | Runtime + ConversationAnchor |

形态决定聊天窗口里出现什么：目标栏（你在跟谁聊）、对话区、记录区和输入框。

## 实时投递

人类聊天通过 SDK 接收 Realm 实时更新。Nimi Chat 使用 App AI 流，Agent Chat 使用 Runtime 强类型 Conversation 事件和已提交快照。各条路径保留所属 owner 的会话、顺序、终止和恢复语义，不是一条通用消息总线。

## 流式聊天

和 AI 或 Agent 对话时，回复是一边生成一边从 Runtime 流出来的。

| 维度 | 取值 |
| --- | --- |
| 协议 | Nimi Chat 使用 App 文本流；Agent Chat 使用强类型 Conversation 轮次与消息事件 |
| 气泡渲染 | 边收到分片边渲染 |
| 中途停止 | 流式期间可用 |
| Agent 部分内容 | 提交前只作临时呈现；中断时清除未提交文本 |
| 投递限制 | 强类型反压/资源失败；不承诺无限缓冲或通用重放 |

Agent Chat 的「停止」请求中断当前轮次。流式增量不是已提交历史，中断时未提交文本会被清除；已提交消息保留，包括关联动作中断前已经提交的文本。恢复以已提交快照为准，不使用部分回复缓存。

## 对话轮次权威

桌面端聊天负责把对话呈现出来，再通过 SDK 把你的输入交出去。模型调用、流式过程、对话的连续性和 Agent 的执行都由 Runtime 处理。桌面端本地没有拦截某一轮对话的入口。

## 读者场景：和 Agent 聊天

你打开聊天，把目标选为自己的 Agent，开始输入。

1. **选定目标**。把 Character/LocalAgent 选为聊天目标。对话界面使用当前已授权 Agent handle 打开该 LocalAgent 的唯一 Conversation，并保留返回的 anchor。
2. **输入**。输入器按强类型输入形态显示。
3. **发送**。这一轮被提交。Runtime 的 `RuntimeAgentService` 为选定 LocalAgent 与 Conversation 接受这一轮。
4. **流式开始**。助手气泡展示 Conversation 事件中的临时增量文本，已提交消息另行记录。
5. **中途停止**。Runtime 报告中断，Desktop 清除未提交回复；已经提交的消息仍保留在快照中。

Character 的持久身份是 Realm 真相；LocalAgent 执行身份、Conversation 连续性和对话记录归 Runtime。与 Agent 的对话不会创建 Realm 人类聊天线程。

## 桌面端聊天不做的事

| 关注点 | 归属 |
| --- | --- |
| 具身化 / 形象呈现 | Avatar 应用——桌面端聊天不再做 Live2D / VRM 的承载面 |
| Memory 权威 | Cognition Agent 私有 Memory，经 Runtime 中介 |
| 两位人类用户的直接聊天线程 | Realm 聊天 |
| 一轮执行权威 | Runtime Agent 服务 |
| 流式语义 | Runtime 流式契约 |

想要看到形象，就去 Avatar 应用。桌面端聊天可以带一些轻量提示（比如表情指示），但聊天窗口本身不再是 Live2D / VRM 的载体。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
