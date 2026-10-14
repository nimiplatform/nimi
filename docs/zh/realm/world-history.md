# 世界历史与仅追加账本（World History）

> **状态说明（设计参考）**：`WorldHistory` 与 `WorldState` 目前属于规划中的独立契约，尚未开放获准的 controller 或纳入 OpenAPI 的读写接口；现有残留数据库模型不代表可调用接口。当前应用可通过 `WorldCore`、`WorldCharacter`、`PersonaCharacter`、`WorldEntity` 与 `WorldRelationship` 按各资源支持的操作访问世界设定及角色资料。

在 Nimi 的数字世界建模中，**世界历史（World History，`R-WHIST-*`）**用于规范记录世界中已获准接纳的发生事实及其来源脉络。它采用**仅限追加（Append-Only）**的时序账本设计，用来回答一个核心问题：*“这个世界是如何一步步演变至今的？”*

私有故事记录、临时会话回合、提示词上下文或应用内部运行状态不会自动变成世界历史；只有经规则接纳的正式世界变更，才会写入共享历史账本。

## 规划契约的核心特征

| 属性维度 | 规格定义 | 设计目的 |
| --- | --- | --- |
| **契约范围** | Realm 世界历史契约（`R-WHIST-*`） | 仅记录已接纳的发生事实，不接收应用私有会话或界面状态 |
| **可变性约束** | 强制仅限追加（Append-Only） | 杜绝静默覆盖、物理硬删除或倒填篡改时间线 |
| **执行模式** | `REPLAY` 与 `CANON_MUTATION` | 将回放推演与真实世界状态/历史提交严格隔离 |
| **提交信封字段** | `worldId`、`appId`、`sessionId`、`effectClass`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs` | 确保每次写入都携带明确的作用域、行为主体、原因说明与证据引用 |
| **勘误机制** | 追加替代记录或无效化记录 | 在不执行硬删除的前提下保留完整的订正轨迹 |

## 提交信封与作用级别（Effect Class）

在规划的写入模型中，提交请求必须显式声明目标作用域 `scope`（`WORLD`、`ENTITY` 或 `RELATION`）以及作用级别 `effectClass`（`NONE`、`STATE_ONLY` 或 `STATE_AND_HISTORY`）。系统不提供默认 `effectClass`：

- **`NONE`**：不提交共享状态，也不追加世界历史。
- **`STATE_ONLY`**：仅更新持久共享状态（`WorldState`），不写入世界历史。
- **`STATE_AND_HISTORY`**：在更新共享状态的同时，将已接纳的事实连同 `actorRefs`、`reason` 与 `evidenceRefs` 一并追加至 `WorldHistory`。

## 两种执行模式的严格隔离

- **回放模式（`REPLAY`）**：用于剧情重演或历史时间线检视。`REPLAY` 模式一律禁止提交共享 `WorldState` 和追加 `WorldHistory`，不存在允许回放写入共享状态的例外。
- **正式变更模式（`CANON_MUTATION`）**：用于推进真实世界状态或写入权威历史。每次 `CANON_MUTATION` 请求都必须通过精确的 `appId`、`schemaId` / `schemaVersion`、`effectClass` 与 `scope` 授权矩阵校验。

## 历史记录的订正与无效化

由于历史账本仅限追加，已提交的记录不能被静默改写或物理硬删除。当需要对既有记录进行订正时，契约规定通过追加新记录来完成：

1. **追加替代（Superseding）**：追加一条明确引用原记录的新事件，并附带修正后的内容、`reason`（原因）与 `evidenceRefs`（证据引用）。
2. **追加无效化（Invalidation）**：追加一条无效化记录，标记原记录在后续状态推演中不再作为有效事实。
3. **保留完整溯源链**：原始记录依然保留在时间线上，便于随时核查最初记录的事实及后续订正的依据。

## 数字世界建模的三个层次

| 建模层次 | 解答的关键问题 | 当前可用接口与规划契约 |
| --- | --- | --- |
| **世界设定与角色** | 这个世界有哪些核心设定、实体与角色？ | **当前已上线**：`WorldCore`、`WorldCharacter`、`PersonaCharacter`、`WorldEntity` 与 `WorldRelationship`（按资源提供明确操作；`WorldRelationship` 对 App 仅开放读取） |
| **世界状态（State）** | 这个世界当前的持久共享状态是什么？ | **规划中契约**：持久共享状态（`WorldState`） |
| **世界历史（History）** | 哪些已接纳的发生事实让世界演变为如今的面貌？ | **规划中契约**：仅追加事实账本（`WorldHistory`） |

## 相关文档

- [世界当前状态规范](/zh/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
