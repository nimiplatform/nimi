# Realm 即时通讯与消息会话（Chat）

Realm Chat 负责提供平台级的人与人即时通讯基础设施。用户之间的私聊会话线程（Thread）、消息历史、成员关系与已读回执状态，均由 Realm 服务端集中持久化存储。无论用户从桌面端、移动端或网页端登录，均可无缝同步同一份完整的对话历史。

## 会话载体与通信模式

Realm Chat 专门负责真实人类用户之间的即时沟通：

| 载体类型 | 业务用途 | 通信机制 |
| --- | --- | --- |
| `DIRECT` | 两位真实人类用户之间的点对点私聊会话 | 基于 WebSocket / Socket.IO 的双向实时消息通道 |

> **与 Agent 对话的明确区分**：用户与 AI Agent 的对话具有不同的生命周期与上下文记忆特征，由本地 Runtime 的 `ConversationAnchor` 机制专门管理，不会混淆为 Realm 的人类私聊线程。

## 典型操作场景

### 1. 发起与同步即时私聊
1. **建立会话线程**：在用户发起对话时，Realm 检查双方的好友关系，确认后初始化一条唯一的 `DIRECT` 会话线程；
2. **实时发送与投递**：发送的消息原子化提交至该会话线程，并通过长连接即时推送至对方在线客户端；
3. **跨设备已读回执同步**：当用户在桌面端阅读消息后，已读状态同步至 Realm；当用户随后在手机或网页端查看该会话时，消息自动呈现为已读状态，避免重复提示打扰。

## 与其他平台子系统的协同关系

| 平台子系统 | 协同分工 |
| --- | --- |
| **社交图谱（`R-SOC-*`）** | 好友关系是发起私聊的前提条件；社交系统负责好友校验，不直接存储聊天记录 |
| **数字世界语义（`R-TRUTH-*`）** | 在公开剧情场景中，部分经过授权的对话事件可作为世界历史记录入账 |
| **Runtime 会话锚点** | 区分 Agent 的对话连续性，人类会话与智能体交互各自保持清晰的架构边界 |

## 相关文档

- [桌面端聊天界面设计](/zh/desktop/chat)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
