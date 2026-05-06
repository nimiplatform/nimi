# 世界演化引擎

世界演化引擎（World Evolution Engine，WEE）是 Runtime 拥有的机器，让世界**感觉是活的** — 角色在动作、场景在推进、事件在累积 — 都在可审计、可重放、fail-closed 的合同下进行。

## WEE 解决什么

一个有规则但没推进的世界只是数据库。一个让任何代码都能在任何时候写规范真相的世界只是混乱。WEE 处于两者中间：一条把参与者输入和定时事件变成提议的修改、校验、暂存为提交请求，然后要么向 Realm 提交要么按显式原因 fail-closed 的类型化管线。

WEE 跑在 Runtime 里。Realm 仍然是真相权威；WEE 是产生格式良好的修改请求供 Realm 准入的引擎。WEE **不**绕过 Realm；它跟 Realm **组合**。

## 九个阶段

WEE 有自己的执行阶段分类，跟 Workflow 不同：

| 阶段 | 顺序 | 用途 |
| --- | --- | --- |
| `INGRESS` | 1 | 接收事件提议 |
| `NORMALIZE` | 2 | 规范化提议形状 |
| `SCHEDULE` | 3 | 在引擎队列里排序 |
| `DISPATCH` | 4 | 把工作交给对的 handler |
| `TRANSITION` | 5 | 计算类型化的状态过渡 |
| `EFFECT` | 6 | 计算下游效果（在场、社交、经济） |
| `COMMIT_REQUEST` | 7 | 把提议的修改暂存为类型化提交请求 |
| `CHECKPOINT` | 8 | 快照引擎中间状态用于 replay |
| `TERMINAL` | 9 | 工作走到终态 |

每个阶段有类型化输入输出。产生不合规输出的阶段 fail-closed；引擎**不**无声回退到通用阶段 handler。

## 只做记录回放

WEE V1 只从**记录的事件、checkpoint、commit-request 结果**回放。它**不**重新推断；它**不**在 replay 中重新做路由选择；它**不**重新调 Model。

这是有意的选择。Replay 是为了理解发生过什么，**不**是为了重新执行。Replay 时重新推断意味着引擎在 replay 里能给出和生产环境不同的答案；那会破坏审计重建。

如果以后某个系统需要确定性的重新执行，必须作为另一种执行模式在自己合同下被准入。

## WEE 跟 Workflow 怎么不一样

WEE 和 Runtime 的 Workflow 面都执行多步工作。它们按设计**分开**。

| 性质 | Workflow | WEE |
| --- | --- | --- |
| 拥有者 | Runtime | Runtime |
| 用途 | 通用 AI 执行图（文本 / 图像 / 等） | 世界演化：把事件变成 Realm 提交 |
| 阶段分类 | 15 个类型化节点（`AI_*`、`TRANSFORM_*`、`CONTROL_*`） | 9 阶段（`INGRESS → ... → TERMINAL`） |
| 状态机 | `ACCEPTED → QUEUED → RUNNING → COMPLETED|FAILED|CANCELED|SKIPPED` | 阶段推进，带类型化终态 |
| Replay | 记录回放，不重新推断 | 记录回放，不重新推断 |
| 输出目标 | 流 / 产物 / 类型化结果 | Realm 提交请求 |

工作流是「用这些参数生成这张图」的合适工具。WEE 是「在类型化合同下让世界推进一个事件」的合适工具。

有一条显式硬切：**禁止**靠复用工作流的某些部分来当 WEE 工作的捷径。靠工作流节点的副作用拼凑世界演化是一种 shadow truth 模式；WEE 有自己的合同正是为了避免这种情况。

## 阅读场景：一次世界事件变成 Realm 提交

参与者在跑在 WEE 里的世界中执行一个动作 — 比如一次脚本化的场景过渡。

1. **`INGRESS`** 接收事件提议：「场景 S 推进到阶段 P」。
2. **`NORMALIZE`** 规范化提议：场景 id 被解析，阶段被照场景规则校验。
3. **`SCHEDULE`** 在引擎队列里给提议排序。如果同一场景有其他提议待处理，排序是类型化的。
4. **`DISPATCH`** 把提议路由到场景推进 handler。
5. **`TRANSITION`** 计算类型化状态过渡：场景从阶段 P-1 走到阶段 P。过渡受已认可的状态过渡规则约束；未定义的过渡 fail-closed。
6. **`EFFECT`** 计算下游效果 — 在场更新、可能的社交状态变化、场景规则带来的经济事件。
7. **`COMMIT_REQUEST`** 把提议的修改暂存为类型化提交请求。请求带 Realm 要求的提交信封：`worldId`、`appId`、`sessionId`、`effectClass`、`scope`、`schemaId`、`schemaVersion`、`actorRefs`、`reason`、`evidenceRefs`。
8. **`CHECKPOINT`** 快照引擎中间状态。如果将来 replay 要重建到这一点的过程，这个 checkpoint 就是锚点。
9. **`TERMINAL`** 记录结果。如果 Realm 准入提交，终态是 `committed`；如果 Realm 拒绝（校验失败、授权失败），终态是 `failed` 带类型化原因。

整个序列被记录。将来的 replay 可以一步步走过它，**不**做任何新的 Model 调用。

## 阅读场景：Replay **不能**追加历史

设想审计想理解昨天某个世界事件出错时发生了什么。

- **Replay 能读**。记录的事件、checkpoint、commit-request 结果足够重建引擎做了什么。
- **Replay 不能追加**。一次 replay run **不是** `CANON_MUTATION` run；世界历史是仅追加，只有 canon-mutating run 才能追加。
- **Replay 不能重新推断**。Replay **不**重调 Model 也**不**重做路由；它复用记录的结果。

这就是 replay 成为真审计工具的原因。如果 replay 能追加或重新推断，它就不是在读过去 — 它在覆盖过去。

## 来源

- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
