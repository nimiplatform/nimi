# Character 与 LocalAgent

Nimi 将持久身份与本地 AI 执行明确分开。

- **Character** 是 Realm 持有的身份、社交与世界真相。PersonaCharacter 和
  WorldCharacter 是 Character 的不同形态，不是独立的本地 Agent 类型。
- **Character Source** 是 Runtime 物化 LocalAgent 时使用的 Realm 来源。
- **LocalAgent** 是有明确 owner 的 Runtime 物化。Runtime 持有其生命周期、
  Conversation、运行态 Memory 与 Knowledge、AI 路由、readiness、预算和状态。

Character 与 LocalAgent 之间不存在额外的平台级 `Agent`、`AgentFamily` 或
`AgentPersona` 身份层。

## Owner 边界

Realm 持有 Character 身份、社交关系、World 成员关系，以及 canonical
Character Source 与 World Source。Runtime 消费已准入的 Character Source
并物化 LocalAgent，但不会接管 Realm 真相。

App、Nimi Home、Desktop 和 Avatar 只能取得当前 session 已授权的投影。它们
不能签发 LocalAgent 身份、从本地历史重建 Runtime 状态，也不会取得 Realm
JWT、Provider Credential、Runtime proof 或账号级 LocalAgent 全量清单。

Avatar 只渲染 Runtime 的强类型 presentation 输入，并保留 renderer-local
状态；它既不是 LocalAgent owner，也不是 AI 的直接 driver。

## 继续阅读

- [Conversation Anchor](./conversation-anchor)
- [跨 Surface 连续性](./cross-surface-continuity)
- [LocalAgent 访问与 App 授权](./participation-authority)
- [跨 World 身份](./cross-world-identity)
- [外部参与](./external-agents)

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
