# 世界演化引擎

## 状态：现在 (Running today)

本概览页描述平台层框架；Runtime 契约深度（已准入但尚未作为可运行引擎交付）见 [WEE 执行](/zh/platform/worlds/wee-execution)。

世界演化引擎（World Evolution Engine，WEE）是 Runtime 持有的机制，让世界感觉是活的 —— 角色在动作、场景在推进、事件在累积 —— 全部在可审计、可重放、fail-closed 的契约下进行。

## WEE 解决的问题

只有规则、没有推进的世界，只是个数据库。任何代码都能在任何时刻写规范化真相的世界，是混乱。WEE 落在两者之间：一条强类型流水线，把参与者输入与排定事件转成提议变更，做校验，按 commit request 暂存，最后要么提交到 Realm，要么以显式原因 fail-closed。

WEE 跑在 Runtime 内。Realm 仍是真相权威；WEE 是给 Realm 准入的「合规变更请求」生产线。WEE 不绕开 Realm，它在 Realm 之上组合。

## 九个阶段

WEE 有自己的执行阶段分类，与工作流相互独立：

| 阶段 | 顺序 | 用途 |
| --- | --- | --- |
| `INGRESS` | 1 | 收下事件提议 |
| `NORMALIZE` | 2 | 把提议形态规范化 |
| `SCHEDULE` | 3 | 在引擎队列里定序 |
| `DISPATCH` | 4 | 派发到对应 handler |
| `TRANSITION` | 5 | 计算强类型状态转移 |
| `EFFECT` | 6 | 算出下游影响（在场、社交、经济） |
| `COMMIT_REQUEST` | 7 | 把提议变更暂存为强类型 commit request |
| `CHECKPOINT` | 8 | 给中间状态做快照，供重放使用 |
| `TERMINAL` | 9 | 工作走到终态结果 |

每一阶段都有强类型输入输出。哪一阶段输出畸形，引擎就 fail-closed，不会偷偷退到一个通用兜底 handler。

## 仅按记录重放

WEE V1 的重放只走**已记录的事件、checkpoint、commit-request 结果**。它不再做推断；不再在重放时挑路径；不再调一次模型。

这是有意为之。重放是用来理解发生了什么，不是用来再执行一遍。重放时若再做推断，引擎在重放与生产里就会给出不同答案，审计重建会塌掉。

如果以后某个系统需要确定性的再执行，那必须以独立执行模式、独立契约的形式准入，不与重放混淆。

## WEE 与工作流的差别

WEE 与 Runtime 的工作流面都执行多步工作。它们按设计相互独立。

| 属性 | 工作流 | WEE |
| --- | --- | --- |
| 归属 | Runtime | Runtime |
| 用途 | 通用 AI 执行图（文/图等） | 世界演化：把事件转成 Realm commit |
| 阶段分类 | 15 个强类型节点（`AI_*`、`TRANSFORM_*`、`CONTROL_*`） | 9 阶段（`INGRESS → ... → TERMINAL`） |
| 状态机 | `ACCEPTED → QUEUED → RUNNING → COMPLETED|FAILED|CANCELED|SKIPPED` | 阶段推进 + 强类型终态结果 |
| 重放 | 按记录重放，不再做推断 | 按记录重放，不再做推断 |
| 输出目标 | 流 / 制品 / 强类型结果 | Realm commit request |

「按这些参数生成这张图」是工作流的事。「在强类型契约下让世界推进一个事件」是 WEE 的事。

存在一条显式硬切：禁止用工作流局部复用作为 WEE 的捷径。把世界演化用工作流节点的副作用拼出来，是一种影子真相模式；WEE 有自己的契约，正是为了不让这件事发生。

## 场景：一次世界事件变成 Realm commit

一段在 WEE 内运行的世界里，某参与者发起一次动作 —— 比如脚本化的场景切换。

1. **`INGRESS`** 收到事件提议：「场景 S 推进到 phase P」。
2. **`NORMALIZE`** 把提议规范化：场景 id 解析，phase 按场景规则校验。
3. **`SCHEDULE`** 在队列中给提议定序。同一场景有别的提议待处理时，定序也是强类型的。
4. **`DISPATCH`** 把提议路由到「场景推进」handler。
5. **`TRANSITION`** 计算强类型状态转移：场景从 phase P-1 走到 phase P。转移受准入的状态转移规则约束；未定义的转移 fail-closed。
6. **`EFFECT`** 计算下游影响 —— 在场更新、可能的社交状态变化、场景规则蕴含的经济事件。
7. **`COMMIT_REQUEST`** 把提议变更暂存为强类型 commit request，附带 Realm 要求的 commit envelope：`worldId`、`appId`、`sessionId`、`effectClass`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs`。
8. **`CHECKPOINT`** 给中间状态做快照。后续重放想还原到这一点，这个 checkpoint 就是锚。
9. **`TERMINAL`** 记录结果。Realm 准入则终态为 `committed`；Realm 拒绝（校验失败、授权失败）则终态为带强类型原因的 `failed`。

整段过程都被记录。后续重放可以一步一步走，无需再调任何模型。

## 场景：重放不能追加历史

某审计员想搞清昨天某次世界事件出错时发生了什么。

- **重放可读**。已记录的事件、checkpoint、commit-request 结果，足以还原引擎当时做了什么。
- **重放不能追加**。重放运行不是 `CANON_MUTATION` 运行；世界历史只追加，仅 canon-mutating 运行可追加。
- **重放不再推断**。重放不再调模型，不再做路由选择；它只复用已记录的结果。

这正是重放成为真审计工具的根据。如果重放能追加或再推断，它读的就不是过去，而是在改写过去。

## 来源依据

- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
