# Character 与 LocalAgent 字段

Nimi 为持久 Character 真相与本地 AI 执行使用不同的 identifier 与 owner。

| 字段或概念 | Owner | 含义 |
| --- | --- | --- |
| Character reference | Realm | 持久身份及社交/World 引用 |
| PersonaCharacter / WorldCharacter | Realm | Realm 持有的 Character 形态 |
| Character Source | Realm | Runtime 物化时可使用的身份来源 |
| World Source | Realm | World 上下文来源；不足以单独创建 LocalAgent identity |
| LocalAgent ID | Runtime | 有明确 owner 的本地执行实体 |
| LocalAgent owner | Runtime | 显式 owner 关系；不能从 App cache 推断 |
| Conversation anchor | Runtime | 一条显式 LocalAgent Conversation |
| 运行态 Memory | Runtime | 已授权的 LocalAgent recall 与 retention |
| 运行态 Knowledge | Runtime | 已授权的 LocalAgent ingestion 与 retrieval |
| AI route 与 readiness | Runtime | Provider/Model route、Quota、Budget 与 readiness |
| Presentation configuration | Runtime | 面向已授权投影的持久 LocalAgent 输入 |
| 短暂 presentation state | Runtime | Turn、状态、activity、emotion、voice 与 timing 投影 |
| Renderer state | Avatar 或 consuming App | 仅短暂渲染、playback 与 interaction |

## 访问字段

Runtime 从 active session 推导 account、App identity、authorization、目标
LocalAgent 或 scope，以及 operation。Consumer 可以提交 LocalAgent ID 作为
目标，但该 ID 不是 authorization proof。

Realm JWT、Provider Credential、Runtime session proof、私有 authorization
evidence、原始 source context 与账号级 LocalAgent 全量清单都不是 App 字段。

## 连续性

LocalAgent ID 不能标识 Conversation。Consumer 保留 Runtime 返回的显式
Conversation anchor。一个 LocalAgent 可以拥有多条 Conversation；同一
Character Source 也可以物化多个 LocalAgent，而不共享可变运行态状态。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
