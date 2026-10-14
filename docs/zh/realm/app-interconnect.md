# 应用互联与 Realm 集成模式（App Interconnect）

Nimi 应用通过 Runtime 托管的宿主绑定与 Realm 交互，而非直接发起底层网络连接。Runtime 负责代管 Realm 凭据与远端连接，仅向应用暴露显式准入的固定类型操作，并将本地智能体运行数据与 Realm 共享资源严格隔离。

## 访问前提与 Runtime 托管边界

应用对 Realm 的每次访问都必须同时满足三项条件：

1. **受保护的宿主会话**：应用必须运行在当前已认证的受保护宿主会话中。
2. **清单声明**：应用清单（Manifest）必须声明所需的 `realm.data` 权限范围。
3. **Runtime 准入与 Realm 资源授权**：Runtime 仅转发显式准入的固定类型操作，且 Realm 仍会对每次请求执行资源级授权校验。

访问 Realm 时，应用通过受保护客户端调用，不直接处理 Realm Bearer Token、原生 HTTP 请求或底层 Socket 连接。传输层协议或 SDK 底层内部导出的符号，不代表普通应用可以直接调用未准入的 Realm 接口。

## 已准入的 Realm 操作范围

当前世界与角色设定源由 `WorldCore`、`WorldCharacter` 和 `PersonaCharacter` 构成。普通应用通过既有宿主绑定 `client.realm.worldCore` 与 `client.realm.personaCharacter` 访问 Realm，且只能执行 Runtime 显式接纳的操作：

| 资源 / 宿主绑定 | 已准入操作 | 操作规则与边界 |
| --- | --- | --- |
| **`WorldCore`**（`client.realm.worldCore`） | `list`、`get`、`create`、`replace`、创建资格查询（creation eligibility） | 新建世界需由 Realm 管理员向账号显式授予世界创建资格，`realm.data` 声明、订阅状态或已有世界所有权均不能替代该资格；读取创建资格不会代替 `create` 时的服务端复检。`replace` 使用 `baseContentHash` 校验并发，保存或修改记录仅更新当前对象，不等同于发布目录。 |
| **`WorldCharacter`** | `list`、`get`、`create`、`replace` | 与 `WorldCore` 分别独立操作，不支持通过单次事务打包发布所有世界对象。 |
| **`WorldEntity`** | `list`、`get`、`create` | 支持在获权世界内查询和创建世界实体。 |
| **`WorldRelationship`** | `list`、`get` | 面向普通应用仅支持读取，未开放 `create` 操作。 |
| **`PersonaCharacter`**（`client.realm.personaCharacter`） | 宿主绑定访问 | 通过 `client.realm.personaCharacter` 宿主绑定访问角色设定资料。 |

## 实时通道与状态边界

并非所有应用数据或实时事件都会经由 Realm 同步：

- **已准入的实时通道**：远端实时连接由 Runtime 统一维护，当前向应用准入的 Realtime 能力仅限人对人的 `DirectChat`、`typing`、`inbox` 和 `Presence`。系统 `Notification` 与通用世界事件广播均未准入。
- **本地智能体与长期记忆**：`LocalAgent` 对话归属 Runtime 处理，`Cognition` 负责管理每个 Agent 的长期记忆并经由 Runtime 中介；应用运行期数据不会自动同步至 Realm。
- **规划中的共享状态契约**：Realm `WorldState` 与 `WorldHistory` 属于规划中的独立契约（仅作设计参考），当前没有面向应用开放的获准 Controller、tracked OpenAPI 读写操作或实时状态订阅接口。

## 相关文档

- [世界状态与历史（设计参考）](/zh/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
