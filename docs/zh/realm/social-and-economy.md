# 社交图谱

Realm Social 管理 Nimi 账号之间的好友关系与拉黑。

## 账号社交图谱（Realm Social）

Realm Social 负责管理真人账号之间的社交关系，当前权威模型由好友关系（`Friendship`）与独立的账号拉黑（`AccountBlock`）组成。

- **唯一有序账号对与状态流转**：每条 `Friendship` 记录使用按确定顺序排列的唯一账号对表示，支持好友申请、状态变更与解除关系。
- **跨世界延续与授权边界**：好友关系绑定在账号层，用户切换世界时无需重复添加好友。但账号层存在好友关系并不意味着所有应用都能全量读取好友信息，实际的可见性与可执行操作仍取决于当前上下文的权限校验。
- **清晰的职责边界**：
  - **即时通讯联动**：人与人之间的私聊会检查适用的好友与拉黑前提条件，而具体的会话与消息流由独立的 [Realm Chat](/zh/realm/chat) 托管。
  - **角色与本地 Agent 隔离**：Realm Social 仅维护真人账号之间的关系，不持有 Character 或 Persona 关系，也不负责 LocalAgent 的创建、对话或长期记忆。

## 应用访问与权限校验

Nimi App 通过受保护的宿主会话发起显式准入的 `client.realm` 调用。Runtime 保管凭据，Realm 对每个请求校验资源级权限。

## 相关文档

- [Realm 即时通讯体系](/zh/realm/chat)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
