# 状态与历史

> 规范状态：规划中契约（设计参考）。世界状态（`R-WSTATE-*`）与世界历史（`R-WHIST-*`）是 Realm 规划中的独立契约，并非当前已上线的可调用接口。当前没有获准的 controller 或纳入跟踪的 OpenAPI 读写操作，现有残留数据库模型也不代表可调用的公开接口。目前普通 App 仅能通过既有宿主绑定的固定接口操作 `WorldCore`、`WorldCharacter`、`WorldEntity` 与 `WorldRelationship`，无法读写或订阅通用世界状态与历史。

在规划的世界数据模型中，Realm 将持久化的世界记录拆分为两个独立表面：**状态**（State，世界当前的持久共享状况）与**历史**（History，已接纳的发生事实序列）。两者职责分明、不可互相替代，由显式协议契约决定每次提交能够更新哪个表面。

## 什么是状态 (State)

| 属性 | 规划契约定义 |
| --- | --- |
| 权威所有者 | Realm World State (`R-WSTATE-*`) |
| 核心定位 | 维护世界持久化的共享当前状态 |
| 作用域 (`scope`) | `WORLD`、`ENTITY`、`RELATION`（其中 `ENTITY` 与 `RELATION` 没有通用 JSON 结构） |
| 变更方式 | 显式提交变更信封 (Commit Envelope) |
| 变更信封字段 | `worldId`、`appId`、`sessionId`、`effectClass`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs` |
| 明确排除的数据 | 应用故事运行变量、提示词上下文、渲染状态、光标与临时状态 |

World State 仅用于承载持久共享状态，不接收应用内的故事控制变量、提示词上下文、画面渲染状态或光标等临时状态。所有共享状态变更都必须通过字段完整的变更信封显式提交。

## 什么是历史 (History)

| 属性 | 规划契约定义 |
| --- | --- |
| 权威所有者 | Realm World History (`R-WHIST-*`) |
| 核心定位 | 记录已接纳的发生事实与来源依据 |
| 写入方式 | 显式仅追加 (Append-Only) |
| 明确排除的数据 | 故事推理轨迹、原始模型输出日志、App 私有叙事存档 |
| 单条记录溯源字段 | `worldId`、`appId`、`sessionId`、`actorRefs`、`reason`、`evidenceRefs` 及关联状态锚点 |
| 修正规则 | 仅允许追加；订正通过追加“替代”或“无效化”记录实现，禁止静默硬删除 |

World History 只接收经平台接纳的发生事实：哪次提交产生了变更、由哪个 App 发起、原因与证据引用是什么。它不是模型生成的原始流式日志；App 私有的故事记录不会自动变成世界历史。

## 由 `effectClass` 决定更新表面

每个变更信封都必须显式声明 `effectClass`，协议不提供默认 `effectClass` 承诺：

| `effectClass` | 状态写入 (State Write) | 历史追加 (History Append) |
| --- | --- | --- |
| `NONE` | 否 | 否 |
| `STATE_ONLY` | 是 | 否 |
| `STATE_AND_HISTORY` | 是 | 是 |

`effectClass` 是受协议严格约束的封闭枚举，调用方不能省略该字段，也不能扩展自定义枚举值。

## 运行模式与授权矩阵

共享状态写入与历史追加同时受运行模式（Run Mode）与精确授权矩阵约束。缺省信封字段、未知 `scope`、无法核验的来源引用，或未命中授权矩阵的请求都会被直接拒绝。

核心约束规则：

| 规则 | 约束说明 |
| --- | --- |
| `REPLAY` 严禁写状态与追加历史 | `REPLAY` 模式一律禁止提交共享 State 和追加 History（`R-WHIST-004`），不存在允许 Replay 写共享状态的例外 |
| `CANON_MUTATION` 须命中精确授权矩阵 | 即使处于 `CANON_MUTATION` 模式，也必须精确通过 `appId`、`schemaId`、`schemaVersion`、`effectClass`、`scope` 组成的授权矩阵校验 |
| App 私有故事存档由 App 管理 | 由 App 自行存储维护，不进入 Realm 世界历史（`R-WHIST-006`） |

## 为什么拆分为两个独立表面

如果只保留**状态**而没有历史：
- 无法从共享记录中回答“在此变更前，系统接纳的事实是什么”。
- 变更的来龙去脉与事后复盘依据会随覆盖写入而丢失。

如果只保留**历史**而没有状态：
- 每次获取世界当前的共享状况，都需要从历史记录流重新推导。
- 查询开销会随历史条目的累积而增长，并发写入时的“当前状态”也难以直接界定。

将两个表面解耦后，每次提交只需通过 `effectClass` 明确声明其写入边界。

## 设计场景参考

### 场景一：`STATE_ONLY` 持久共享状态更新

获准的 App 更新一项持久共享状态，但该变更无需作为历史事件归档：

1. **提交变更信封**：App 提交包含 `worldId`、`appId`、`sessionId`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs` 的完整信封，并显式声明 `effectClass: STATE_ONLY`。
2. **契约校验**：Realm 核验当前运行模式为 `CANON_MUTATION`，并校验 `(appId, schemaId, schemaVersion, effectClass, scope)` 授权矩阵与 Schema 结构。
3. **状态更新**：对应的持久共享状态记录完成更新。
4. **历史不变**：不向 World History 追加记录。

### 场景二：`STATE_AND_HISTORY` 事实变更提交

获准的 App 提交一项需要记入世界编年记录的重要事实变更：

1. **提交变更信封**：显式声明 `effectClass: STATE_AND_HISTORY`。
2. **契约校验**：Realm 校验信封结构、来源依据（`actorRefs`、`reason`、`evidenceRefs`）、`CANON_MUTATION` 运行模式，以及覆盖 `app`、`schema`、`effect`、`scope` 的精确授权矩阵。
3. **状态更新**：世界共享当前状态随之更新。
4. **历史追加**：在 World History 中追加一条带完整来源信息的新记录。

### 场景三：订正既有历史记录

早期已接纳的一条历史记录需要订正：

1. **禁止静默硬删除**：原始历史记录保持原样，不被物理抹除。
2. **追加替代或无效化记录**：提交一条新的历史记录，引用原记录标识并写明订正的 `reason` 与 `evidenceRefs`，标明对原记录的替代或无效化。
3. **保留完整链路**：原始记录与订正记录同时留在仅追加日志中，确保来源脉络清晰。

### 场景四：`REPLAY` 模式尝试写入状态或历史

回放消费者在 `REPLAY` 模式下重新执行一段流程：

1. **本地执行回放**：系统在 `REPLAY` 模式下重演过程。
2. **全面拦截共享写入**：一旦尝试提交变更信封，Realm 一律拒绝其共享 State 提交与 History 追加（`R-WHIST-004`）。
3. **无写状态例外**：`REPLAY` 模式不存在任何可写入共享世界状态或历史的例外通道。

### 场景五：App 管理私有故事记录

互动叙事类 App 需要保存玩家会话中的故事变量与对话记录：

1. **排除在 Realm 之外**：应用故事运行变量、提示词上下文、渲染状态与私有对话记录均不属于 World State 或 World History。
2. **App 自有存储**：App 在自有存储中维护叙事日志（`R-WHIST-006`）。
3. **边界清晰**：私有故事记录不会自动转化为世界历史，也不得作为世界历史对外呈现。

## 关键架构边界

- World State 与 World History 是规划中的独立契约，当前没有获准的 controller 或 OpenAPI 读写接口。
- World State 仅保存持久共享状态（`WORLD`、`ENTITY`、`RELATION`），不收纳应用故事运行变量、提示词上下文、渲染状态或光标/临时状态。
- `ENTITY` 与 `RELATION` 作用域没有通用 JSON 结构。
- `effectClass`（`NONE`、`STATE_ONLY`、`STATE_AND_HISTORY`）无默认值承诺，且不支持自定义扩展。
- `REPLAY` 模式一律禁止共享 State 提交和 History 追加，无任何写状态例外。
- `CANON_MUTATION` 必须通过精确的 `appId`、`schemaId`、`schemaVersion`、`effectClass`、`scope` 授权矩阵校验。
- 历史订正通过追加替代或无效化记录完成，禁止静默硬删除。

## 职责边界速查

| 关注点 | 规划权威所有者 |
| --- | --- |
| 持久共享当前状态 | Realm (`R-WSTATE-*`) |
| 已接纳发生事实与溯源记录 | Realm (`R-WHIST-*`) |
| 变更信封结构校验 | Realm (`R-WSTATE-002`) |
| 运行模式与 `(app, schema, effect, scope)` 授权矩阵 | Realm (`R-WSTATE-005`) |
| `effectClass` 封闭枚举 | Realm (`R-WSTATE-004`) |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
