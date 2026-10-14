# Realm 即时通讯与消息会话（Chat）

Realm Chat 提供人与人之间的即时通讯基础设施。私聊会话线程（Thread）、消息历史、成员关系与已读回执状态均由 Realm 权威持久化。已授权客户端读取同一份 Realm 会话记录；这项服务契约不代表公开网站或移动客户端当前已经提供聊天界面。

## 会话载体与通信模式

Realm Chat 专门负责真实人类用户之间的即时沟通：

| 载体类型 | 业务用途 | 通信机制 |
| --- | --- | --- |
| `DIRECT` | 两位真实人类用户之间的点对点私聊会话 | 基于 WebSocket / Socket.IO 的双向实时消息通道 |

> **与 Agent 对话的明确区分**：用户与自治 AI 智能体的交互涉及动态上下文构建与推理，由本地 Runtime 通过 `ConversationAnchor` 独立管理，不会在 Realm 中创建普通的人类私聊线程。

## 典型操作场景

### 1. 发起与同步即时私聊
1. **建立会话线程**：用户发起对话时，Realm 校验双方在社交图谱中的好友关系，确认后建立唯一的 `DIRECT` 线程。
2. **实时发送与投递**：发送的消息原子化提交至会话账本，并通过长连接即时推送给对方活跃客户端。
3. **跨设备已读状态同步**：用户在某一客户端（如桌面端）阅读消息后，已读状态同步至 Realm；随后在其他客户端打开该会话时，消息已直接标记为已读。

## 与其他平台子系统的协同关系

| 平台子系统 | 协同分工 |
| --- | --- |
| **社交图谱（`R-SOC-*`）** | 好友关系是发起私聊的前提条件；社交系统负责关系校验，不直接存储聊天正文内容 |
| **数字世界语义（`R-TRUTH-*`）** | 在公开场景中，部分经授权的对话事件可选择性归档至世界历史 |
| **Runtime 会话锚点（ConversationAnchor）** | Agent 对话轮次的连续性由本地 Runtime 独立维护，确保人类通讯与智能体对话边界分明 |
## 相关文档

- [桌面端聊天界面指南](/zh/desktop/chat)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
