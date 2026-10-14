# 核心系统状态机模型（State Machines）

Runtime 健康状态与异步任务各自遵循明确的生命周期，Realm 世界设定编辑区分当前可用操作与规划中的共享状态契约，而 Avatar 是否可用则取决于当前 App 会话和呈现条件。

## 1. Runtime 守护进程生命周期（Daemon Health）

| 状态 | 状态含义 | 允许的操作 |
| --- | --- | --- |
| `STARTING` | 守护进程正在启动，初始化各模块 | 加载本地配置与模型目录 |
| `READY` | 守护进程正常提供 RPC 服务 | 接收并处理 RPC 调用；具体推理能力的可用性取决于本地模型与环境先决条件 |
| `DEGRADED` | 核心守护进程正常运作，但特定子系统检查或诊断报告了降级状态 | 记录诊断日志，仅提供受支持的非降级子系统操作 |
| `STOPPING` | 正在优雅停机，排空活动中的流式请求 | 拒绝新任务，安全刷盘当前写入流 |

## 2. 异步计算任务状态机（ScenarioJob）

耗时较长的多模态生成任务遵循明确的异步生命周期流转：

| 状态代码 | 是否为终态 | 业务说明 |
| --- | --- | --- |
| `SUBMITTED` | 否 | 任务已通过参数校验并注册，等待排队 |
| `QUEUED` | 否 | 任务已进入工作池队列，等待分配计算资源 |
| `RUNNING` | 否 | 模型正在执行推理计算或 Token 生成 |
| `COMPLETED` | **是（成功终态）** | 任务执行成功；所有输出产物已就绪可访问 |
| `FAILED` | **是（异常终态）** | 执行中遇到错误，附带具体诊断错误码 |
| `TIMEOUT` | **是（异常终态）** | 执行达到服务商超时限制，或已确认为最大超时状态 |
| `CANCELED` | **是（终态）** | 收到停止请求；需检查 `stopOutcome`（如 confirmed 或 unconfirmed）确认底层计算是否实际中止 |

作业可通过可选的 `submissionOutcome` 反映分发状态。对于 `CANCELED` 取消作业，会通过 `stopOutcome` 说明底层计算是否已确认中止（如 `confirmed`）或尚未确认（`stopOutcome: 'unconfirmed'`）。其他终态不会携带 `stopOutcome`；超时作业遵循既有的作业观测与恢复契约处理。

## 3. Realm 世界编辑与规划中的共享状态边界

Realm 不采用按世界独占的 App 绑定状态机。App 访问 Realm 需具备受保护的宿主会话、清单 `realm.data` 声明并经 Runtime 准入，同时由 Realm 校验资源级授权；Realm 凭据与远端连接由 Runtime 统一保管。

### 当前世界设定与编辑操作

当前设定源由 `WorldCore`、`WorldCharacter` 与 `PersonaCharacter` 构成。普通 App 通过宿主绑定的 `client.realm.worldCore` 与 `client.realm.personaCharacter`，仅可执行 Runtime 显式接纳的固定类型操作：

| 资源类型 | 已准入的 App 操作 | 边界说明 |
| --- | --- | --- |
| `WorldCore` | `list`、`get`、`create`、`replace`、创建资格查询 | 新建世界需由 Realm 管理员显式授予账号创建资格（`realm.data` 权限、订阅或已有世界所有权均不可替代，且读取资格不能代替创建时的服务端复检）。`replace` 通过 `baseContentHash` 进行并发校验。 |
| `WorldCharacter` | `list`、`get`、`create`、`replace` | 与 `WorldCore` 分别独立操作，不以单次多对象事务打包发布。 |
| `WorldEntity` | `list`、`get`、`create` | 针对目标世界的固定类型实体操作。 |
| `WorldRelationship` | `list`、`get` | 对 App 仅开放读取，未开放 App 侧关系创建。 |

### 规划中的 World State 与 World History（设计参考）

Realm `World State` 与 `World History` 是规划中的独立契约；当前没有获准的 controller 或纳入 OpenAPI 的读写操作，也未向 App 开放通用世界状态或历史的写入与订阅。

- **`WorldState` 范围**：仅面向持久化的共享世界状态，不收录应用故事运行变量、提示词上下文、渲染状态、光标或临时状态。
- **提交信封字段**：规划中的状态提交包含 `worldId`、`appId`、`sessionId`、`effectClass`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs`。
- **作用范围与生效级别**：`scope` 取值为 `WORLD`、`ENTITY`、`RELATION`（其中 `ENTITY` 与 `RELATION` 不采用任意通用 JSON 结构）；`effectClass` 取值为 `NONE`、`STATE_ONLY`、`STATE_AND_HISTORY`，需显式指定，不提供默认级别承诺。
- **写入与回放约束**：`REPLAY` 一律禁止提交共享 State 或追加 History，无任何例外；`CANON_MUTATION` 还须匹配精确的 `app` / `schema` / `effect` / `scope` 授权矩阵。
- **历史记录语义**：`World History` 仅收录已接纳的发生事实；事实订正通过追加替代或无效化记录完成，不做静默硬删除；私有故事记录不会自动转为世界历史。

## 4. Avatar 就绪条件

Avatar 根据当前 App 会话、启动上下文、驱动和模型条件选择窗口内容。开放产品交互还需要后端呈现就绪。

| 当前条件 | 界面表现 | 产品交互 |
| --- | --- | --- |
| 窗口或 Runtime 尚未准备完成 | 加载界面 | 不可用 |
| 会话、启动参数、驱动或模型条件不满足 | 诊断界面，显示具体原因 | 不可用 |
| 已通过验证的开发预览（`fixture_not_verified`） | 显示模型，并明确标注为开发预览 | 不可用；预览画面不代表 Runtime 绑定有效 |
| App 会话来自 Runtime，所需条件有效，后端呈现已就绪 | 显示产品模型视图；需要时显示 Companion 面板 | 可用 |

当前 App 的诊断值和启动字段要求见 [Avatar 实例生命周期](/zh/avatar/instance-lifecycle)。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
