# 数字世界生命周期管理（World Lifecycle）

Nimi 中的数字世界通过受 Realm 权威管控、经由 Runtime 准入中介的资源操作进行创建与演进。世界设定与日常维护围绕 `WorldCore`、`WorldCharacter` 和 `PersonaCharacter` 等核心设定源，以及结构化的实体（`WorldEntity`）与关系（`WorldRelationship`）展开，而非依赖单一的打包发布事务。

字段层面的规范定义与运行时状态说明，请参阅 [参考手册 → 系统核心状态机](/zh/reference/state-machines) 与 [参考手册 → 数字世界核心字段](/zh/reference/world-fields)。

## 世界创建资格与新建流程

在 Realm 中新建数字世界是一项受严格管控的操作：

- **管理员显式授权**：账号必须由 Realm 管理员显式授予“世界创建资格（creation eligibility）”后，才能发起新建世界操作。
- **无隐式替代条件**：应用清单中声明 `realm.data`、持有订阅权益或已拥有其他数字世界，均不能替代管理员授予的创建资格。
- **预检与创建时复检**：应用可通过 `client.realm.worldCore` 查询当前账号的创建资格，但资格读取仅作为前置参考，不能替代创建时的权限校验——Realm 会在收到 `create` 请求时再次执行权威复检。

## 设定维护与资源操作

数字世界的各项设定按资源类型分别维护，并非通过单次跨对象事务整体打包发布。普通应用通过宿主绑定 `client.realm.worldCore` 与 `client.realm.personaCharacter` 访问世界资源，且只能执行 Runtime 显式接纳的固定类型操作：

| 资源与接口面 | 已准入操作 | 操作说明 |
| --- | --- | --- |
| **`WorldCore`** | `list`、`get`、`create`、`replace`、创建资格查询 | 维护世界核心设定与元数据；与 `WorldCharacter` 分别独立操作 |
| **`WorldCharacter`** | `list`、`get`、`create`、`replace` | 维护所属数字世界的常驻角色资料 |
| **`WorldEntity`** | `list`、`get`、`create` | 维护世界内的结构化实体 |
| **`WorldRelationship`** | `list`、`get` | 仅供应用读取，不提供应用侧 `create` 接口 |
| **`PersonaCharacter`** | 经由 `client.realm.personaCharacter` 宿主绑定操作 | 维护独立的人格角色设定 |

### `WorldCore` 字段结构与可见性

当前 `WorldCore` DTO 包含以下字段：

- `id`：数字世界唯一标识
- `schemaVersion`：核心数据结构版本号
- `contentRevision`：内容修订版本计数
- `contentHash`：当前核心内容的哈希值
- `origin`：创建来源元数据
- `visibility`：可见性范围（`private`、`unlisted`、`public`、`system`）
- `lorebookDeclaration`：关联的设定集（Lorebook）声明结构
- `core`：结构化的世界核心设定内容
- `createdAt` / `updatedAt`：创建与更新时间戳
- `creatorId`：可选（可为 `null`）的创建者账号标识

### 基于 `baseContentHash` 的乐观并发控制

通过 `replace` 更新 `WorldCore` 或 `WorldCharacter` 时，必须传入当前编辑版本对应的 `baseContentHash`。Realm 会在写入前校验 `baseContentHash` 是否与最新 `contentHash` 一致，从而防止并发修改互相覆盖。

保存或替换记录仅更新该资源本身的存储状态及 `contentRevision` / `contentHash`，不等同于发布世界目录或生成独立的发布包。

## 应用访问与 Runtime 准入边界

应用访问 Realm 资源时受到宿主与 Runtime 的严格隔离保护：

1. **三重访问准入**：应用发起的每次 Realm 访问都必须同时具备受保护的宿主会话、应用清单中的 `realm.data` 声明以及 Runtime 准入许可；Realm 服务端仍会对具体资源执行授权校验。
2. **凭据与连接托管**：Runtime 统一保管 Realm 访问凭据并维护远端实时连接，应用无法直接获取 Bearer Token、原生 HTTP 客户端或底层 Socket 连接。
3. **已准入的 Realtime 范围**：当前对应用开放的实时通道仅限人对人 DirectChat、正在输入状态（typing）、收件箱（inbox）与在线状态（Presence）；通知（Notification）与通用世界事件广播未向应用开放。
4. **LocalAgent 与长期记忆边界**：LocalAgent 对话由 Runtime 负责调度执行，每个 Agent 的长期记忆由 Cognition 经 Runtime 中介管理；应用内的运行数据不会自动同步至 Realm。

## 系统主世界 OASIS

OASIS 是系统的主世界（`visibility` 为 `system`），其 `WorldCore` 与常驻角色资料可直接通过当前正式接口读取使用。关于跨世界漫游协议的详细架构设计，请参阅 [系统主世界 OASIS](/zh/platform/worlds/oasis)。

## 规划中的共享状态与历史

World State 与 World History 定义了持久共享状态和已接纳事实的记录模型，目前尚无对应的公开读写接口。它们与今天可编辑的 WorldCore、角色资料是不同的层次。

规划契约要求显式提交和精确授权，`REPLAY` 不能写入共享状态或历史，应用私有故事记录也不会自动成为世界历史。完整模型见[状态与历史](/zh/platform/worlds/state-vs-history)。

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
