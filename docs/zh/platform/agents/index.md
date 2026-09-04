# Character 与 LocalAgent

角色是 Nimi 里持久的参与者。一个角色有稳定的身份：无论在哪个世界、哪段
对话里，它都是同一个，而且这份身份一直延续。Realm 保存这份身份。

LocalAgent 是 Runtime 把角色在本地运行起来的方式。当你开始一段体验，
Runtime 读取角色的描述，也就是 Realm 签发的 Character Source，在你的机器
上把它运行起来。LocalAgent 持有这次运行的对话、记忆和知识。角色本身的身
份始终留在 Realm。

- **Character** 是由 Realm 保存的身份、关系和世界成员关系。
  PersonaCharacter 和 WorldCharacter 是 Character 的形态，不是独立的本地
  Agent 类型。
- **Character Source** 是 Realm 签发、供 Runtime 运行角色的描述。
- **LocalAgent** 是 Runtime 为你创建的运行实例。Runtime 管理它的生命周
  期、Conversation、运行态 Memory 与 Knowledge、模型路由、readiness、预
  算和状态。

Character 与 LocalAgent 之间没有额外的平台级 `Agent`、`AgentFamily` 或
`AgentPersona` 身份层。

## Owner 边界

Realm 是角色身份的家：角色是谁、它的关系、它的世界成员关系，以及其他
部分赖以构建的角色与世界描述，都归 Realm 保管。Runtime 拿着 Realm 签发
的 Character Source 运行出 LocalAgent，但不接管 Realm 保存的任何东西。

App、Nimi Home、桌面端和 Avatar 只能看到当前会话授权它们看到的内容。
它们不能创建 LocalAgent 身份，不能从本地历史重建 Runtime 状态，也拿不
到 Realm 凭证、Provider 密钥、Runtime 内部凭据或账号级 LocalAgent 全量
清单。

Avatar 渲染 Runtime 发来的强类型呈现内容，并保留自己 renderer 本地的状
态。它不运行 LocalAgent，也不直接驱动 AI。

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
