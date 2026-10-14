# 世界状态与提交信封模型（World State）

在 Nimi 的世界架构中，**世界状态（World State）**是一项规划中的独立契约，用于表达数字世界的**持久共享状态**，回答“这个世界当前的共享状态是什么”这一问题。

> **设计参考说明：** World State 与 World History 目前属于规划中的契约模型，本文档作为架构设计参考提供。当前 Realm 并未开放对应的控制器、OpenAPI 读写接口或实时世界事件广播，底层残留的数据表结构也不代表可调用的公开接口。现阶段，应用通过 Runtime 准入的固定类型操作访问与管理世界和角色设定（包括 `WorldCore`、`WorldCharacter`、`WorldEntity`、`WorldRelationship` 与 `PersonaCharacter`）。

关于持久共享状态（State）与仅追加历史（History）的边界对比，请参阅[状态与历史对比](/zh/platform/worlds/state-vs-history)。

## 状态边界：什么属于 World State

在规划模型中，World State 仅用于承载受 Realm 治理的**持久共享状态**：

- **纳入范围：** 跨会话持久生效、由明确 Schema 与授权矩阵约束的世界级或实体/关系级共享状态。
- **排除范围：** 应用内的故事运行变量、提示词上下文（Prompt Context）、渲染状态、光标位置以及其他临时或客户端本地状态。这些数据由应用或会话自行管理，不写入 World State。

## 提交信封（Commit Envelope）字段规范

在规划契约中，每一次针对世界状态的变更提案均通过结构化的提交信封（Commit Envelope）表达：

| 关键字段 | 字段说明 |
| --- | --- |
| `worldId` | 目标世界 ID |
| `appId` | 发起请求的应用 ID |
| `sessionId` | 关联的当前会话 ID |
| `effectClass` | 变更影响分类（`NONE`、`STATE_ONLY` 或 `STATE_AND_HISTORY`） |
| `scope` | 变更作用范围（`WORLD`、`ENTITY` 或 `RELATION`） |
| `schemaId` / `schemaVersion` | 约束变更载荷的数据 Schema 标识与版本 |
| `actorRefs` | 触发该动作的用户或角色引用 |
| `reason` | 人类可读的变更原因说明 |
| `evidenceRefs` | 支撑本次变更的证据引用 |

## 作用范围与变更影响分类

### 作用范围（`scope`）

- `WORLD`：世界级共享状态变更。
- `ENTITY`：针对单个实体的共享状态变更。
- `RELATION`：针对实体间关系的共享状态变更。

`ENTITY` 与 `RELATION` 并不提供通用的自由 JSON 结构，所有变更载荷都必须匹配明确的 `schemaId` 与 `schemaVersion` 定义。

### 变更影响分类（`effectClass`）

契约不提供默认的 `effectClass`，调用方必须显式声明：

- `NONE`：不修改共享状态，也不追加世界历史记录。
- `STATE_ONLY`：仅更新持久共享状态，不向世界历史追加记录。注意该分类依然仅适用于持久共享状态，不用于光标、临时标记或渲染状态。
- `STATE_AND_HISTORY`：更新持久共享状态，并同步向[世界历史](/zh/realm/world-history)追加一条已接纳的发生事实。

## 运行模式与授权边界

规划中的共享状态变更遵循严格的运行模式与授权矩阵约束：

- **`REPLAY` 模式：** 一律禁止提交共享 World State 变更或追加 World History，不存在允许 `REPLAY` 写入共享状态的例外。
- **`CANON_MUTATION` 模式：** 必须通过精确到 `app`、`schema`、`effect` 与 `scope` 的授权矩阵校验，方可执行状态提交。
- **历史记录边界：** World History 仅收纳已接纳的发生事实；私有故事记录不会自动转化为世界历史，对既有历史的订正通过追加替代或无效化记录完成，而非静默硬删除。

## 相关文档

- [世界历史与仅追加日志](/zh/realm/world-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
