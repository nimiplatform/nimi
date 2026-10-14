# 数字世界核心字段与规范（World Fields）

本文档介绍 Nimi 数字世界（World）与角色设定的当前数据结构、应用可通过 Runtime 调用的正式操作，以及规划中的世界共享状态（World State）与世界历史（World History）契约设计参考。

## 世界数据契约概览：当前模型与规划契约

Realm 中的世界数据分为当前已开放的设定模型与规划中的状态/历史契约：

| 领域 | 当前状态 | 职责范围 |
| --- | --- | --- |
| **世界与角色设定（`WorldCore`、`WorldCharacter`、`PersonaCharacter`）** | **当前接口** | 维护世界基础设定、设定集声明（Lorebook）、角色档案、世界实体（`WorldEntity`）与关系（`WorldRelationship`）。 |
| **世界状态（`WorldState`）** | **规划中（设计参考）** | 维护跨会话的持久共享世界状态。当前尚未开放获准的 controller 接口或 tracked OpenAPI 读写操作。 |
| **世界历史（`WorldHistory`）** | **规划中（设计参考）** | 记录已接纳发生事实的仅追加账本。当前尚未开放获准的 controller 接口或 tracked OpenAPI 读写操作。 |

## `WorldCore` DTO 字段定义

`WorldCore` 表示数字世界的核心设定与元数据记录：

| 字段名 | 类型 / 取值 | 说明 |
| --- | --- | --- |
| `id` | `string` | 世界唯一且不可变的字符串标识。 |
| `schemaVersion` | `string` | `WorldCore` 数据结构的模式版本。 |
| `contentRevision` | `number` | 世界记录的内容修订版本号。 |
| `contentHash` | `string` | 当前内容哈希值；在执行 `replace` 更新时作为 `baseContentHash` 用于乐观并发校验。 |
| `origin` | `RealmCoreOriginDto` | 世界记录的来源分类。 |
| `visibility` | `'private' \| 'unlisted' \| 'public' \| 'system'` | 世界的可见性与访问层级。 |
| `lorebookDeclaration` | `WorldLorebookDeclarationV1Dto \| null` | 与该世界关联的设定集（Lorebook）结构化声明。 |
| `core` | `WorldCoreValueDto` | 世界核心设定载荷。 |
| `createdAt` | `string` | 创建时间戳。 |
| `updatedAt` | `string` | 最近更新时间戳。 |
| `creatorId` | `string \| null`（可选） | 创建者账号标识（可为空）。 |

## 应用访问条件与受支持的操作

普通应用不直接持有 Realm Bearer 凭据，也不直接向 Realm 发起原生 HTTP 或 Socket 连接。应用访问 Realm 数据需同时满足以下条件：

1. 处于当前受保护的宿主会话中；
2. 应用清单（Manifest）已声明 `realm.data` 权限；
3. 通过 Runtime 准入校验，并由 Realm 完成资源级授权检查。

应用通过既有宿主绑定 `client.realm.worldCore` 与 `client.realm.personaCharacter`，仅可执行 Runtime 显式接纳的固定类型操作：

| 资源类型 | 支持的应用操作 | 操作说明 |
| --- | --- | --- |
| `WorldCore` | `list`、`get`、`create`、`replace`、创建资格查询（creation eligibility） | `replace` 需传入 `baseContentHash`。保存或替换仅更新对应记录本身，不代表发布目录或打包发布所有世界对象。 |
| `WorldCharacter` | `list`、`get`、`create`、`replace` | 与 `WorldCore` 分别独立操作，不通过单次事务打包发布。 |
| `WorldEntity` | `list`、`get`、`create` | 固定类型的世界实体读写操作。 |
| `WorldRelationship` | `list`、`get` | 仅支持读取；不对应用开放 `WorldRelationship` 创建操作。 |

> **新建世界资格要求**：创建新世界（`WorldCore.create`）需由 Realm 管理员向账号显式授予世界创建资格。声明 `realm.data`、持有订阅或已拥有其他世界均不能替代该资格；创建前的资格查询（eligibility）仅作参考，不替代创建时的正式权限复检。

> **实时连接与本地智能体边界**：远端 Realtime 连接由 Runtime 统一托管。目前已准入的实时能力仅限人对人私聊（DirectChat）、输入状态（typing）、收件箱（inbox）与在线状态（Presence），通知（Notification）与通用世界事件广播均未开放。LocalAgent 对话由 Runtime 承载，单 Agent 长期记忆由 Cognition 经 Runtime 中介管理，应用数据不会自动全量同步至世界状态。

## 规划中的状态与历史契约（设计参考）

`WorldState` 与 `WorldHistory` 是规划中的独立契约，目前不提供通用的状态/历史写入或订阅接口。以下模型定义仅作为架构设计参考。

### 数据边界

- **持久共享状态（`WorldState`）**：仅收纳持久化的世界共享状态，不接收应用内的故事运行变量、提示词上下文、渲染状态、光标位置或临时会话状态。
- **发生事实账本（`WorldHistory`）**：仅收纳经接纳的发生事实。事实订正通过追加替代记录或无效化记录完成，不支持静默硬删除；应用内的私有故事记录不会自动转为世界历史。

### 规划中的提交信封（Commit Envelope）

状态与历史提交使用统一的信封结构：

| 字段名 | 规范说明 |
| --- | --- |
| `worldId` | 目标世界标识。 |
| `appId` | 发起提交的应用标识。 |
| `sessionId` | 当前会话标识。 |
| `scope` | `'WORLD' \| 'ENTITY' \| 'RELATION'`（其中 `ENTITY` 与 `RELATION` 需遵循特定模式，不提供通用 JSON 结构）。 |
| `effectClass` | `'NONE' \| 'STATE_ONLY' \| 'STATE_AND_HISTORY'`（必须显式指定，无默认 `effectClass`）。 |
| `schemaId` | 目标数据模式标识。 |
| `schemaVersion` | 目标数据模式版本。 |
| `actorRefs` | 参与本次变更的行动者引用列表。 |
| `reason` | 变更原因说明。 |
| `evidenceRefs` | 支撑本次变更的证据引用列表。 |

### 演进模式约束

- **`REPLAY`（重演模式）**：一律禁止提交共享 `WorldState` 或追加 `WorldHistory`，不存在允许 Replay 写入共享状态的例外。
- **`CANON_MUTATION`（正史演进）**：必须严格匹配应用（app）、模式（schema）、影响级别（effectClass）与作用域（scope）的精确授权矩阵。

## OASIS 系统主世界

- **系统主世界定位**：OASIS 是平台内置的系统主世界（`visibility: 'system'`）。
- **正式接口访问**：应用可通过当前正式接口读取和使用 OASIS 的 `WorldCore` 与角色资料。
- **漫游协议设计**：关于跨世界漫游的详细架构设计请参阅 OASIS 与 Transit 协议文档；保存世界记录不会自动将应用接入跨世界漫游网络。

## 相关文档

- [世界状态机制详解](/zh/realm/world-state)

## Source Basis

- [`config/realm-openapi/api-nimi.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/realm-openapi/api-nimi.yaml)

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
