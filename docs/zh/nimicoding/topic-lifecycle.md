# Topic 生命周期

一个 topic 是权威性或高风险工作主线的受治理容器。本页说明 topic 的状态机：粗粒度生命周期（`proposal → ongoing → pending → closed`）、wave 的细粒度状态，以及独立的 true close 状态。

工作如何在状态机里推进，详见 [Topic 工作流](/zh/nimicoding/topic-workflow)。

## 粗粒度生命周期

| 状态 | 含义 |
| --- | --- |
| `proposal` | 尚未启动的规划阶段 |
| `ongoing` | 实施进行中 |
| `pending` | 暂停，等待证据或外部触发 |
| `closed` | 不再是活跃工作主线 |

状态记录在 `topic.yaml` 中。文件夹位置随状态变化，但单凭文件夹移动**不算**状态证据，`topic.yaml` 才是。

## 细粒度状态

在粗粒度状态之下还有更细的机器状态：

| 细粒度状态 | 对应粗粒度 |
| --- | --- |
| `design_only` | proposal / ongoing |
| `implementation_ready` | ongoing |
| `implementation_active` | ongoing |
| `true_close_pending` | pending / closed |
| `true_closed` | closed |
| `revoked` | closed（可重开） |
| `superseded` | closed |

这些细粒度状态在 topic 工件和审计记录里都能观察到。

## 转移规则

允许的转移：

| 源 → 目标 | 备注 |
| --- | --- |
| `proposal → ongoing` | 需要预检、唯一选定的 next target、有界的停止线、已消费输入、预期 closeout 检查、显式禁用反模式 |
| `ongoing → pending` | 当前没有活跃实施 wave，附带 pending-note 写明重开条件或 close 触发条件 |
| `pending → ongoing` | 重启工作；需要新 wave 准入 |
| `ongoing → closed` | 所有已关闭 wave 都完成 wave 级 closeout；topic 级 closeout 记录最终处置 |
| `pending → closed` | 同 ongoing → closed |
| `proposal → closed` | 不实施直接关闭 |
| `closed → ongoing` | 必须显式重开（不能随手编辑） |
| `ongoing → proposal` | 从活跃状态退回重新规划 |

禁止：

- 同时存在多份并行 topic 副本（同一时间只能有一份规范副本）。

## Wave 状态

topic 内部的 wave 有自己的状态机。

| Wave 状态 | 是否终态 |
| --- | --- |
| `candidate` | 否 |
| `preflight_draft` | 否 |
| `preflight_admitted` | 否 |
| `implementation_admitted` | 否 |
| `implementation_active` | 否 |
| `needs_revision` | 否 |
| `overflowed` | 否（需要显式续作或修订） |
| `continuation_packet_open` | 否 |
| `closed` | 是 |
| `retired` | 是 |
| `superseded` | 是 |

`retired` 或 `superseded` 状态的 wave 不可派发。`overflowed` 不会被静默归一为 `closed`，溢出后续作必须经显式准入。

## True Close

true close **不等同于 topic 状态 `closed`**。一个 topic 可以在文件夹层面已关闭，但 true close 尚未通过；true close 需要单独的审计记录确认闭合经过独立核验。

| `current_true_close_status` | 含义 |
| --- | --- |
| `not_started` | 尚未启动 true close |
| `pending` | true close 进行中 |
| `true_closed` | true close 已通过 |
| `revoked` | 已通过的 true close 被后续独立审计撤销 |
| `superseded` | true close 被更晚的准入取代 |

通过的 true close 也可以被后续独立审计撤销；被撤销的 true close 需要后续血缘记录跟进。早期公共文档 topic 在机器侧 true-close 通过，后因人工验收不达标转入修复，正是利用了这个机制。

## 五层闭合证据

完整的 closeout 纪律对应五个独立证据面：

| 层 | 覆盖什么 |
| --- | --- |
| Context closure | 某个上下文已抵达稳定的规划停止线 |
| Wave closeout | 某个已准入 wave 抵达停止线，并附带四闭合的有界证据 |
| Pending hold | topic 暂停期间没有活跃开发，但保留显式重开或关闭条件 |
| Topic closeout | topic 不再是活跃工作主线 |
| True close | topic 经独立审计核验为已完成 |

这五层必须**保持独立**。把 wave closeout 折叠进 topic closeout，或把 topic closeout 当成 true close，都会丢失信息。

## 场景：一个 topic 的完整轨迹

一个承载实质 AI 编码工作的 topic 大致如下：

| 阶段 | 发生什么 |
| --- | --- |
| `proposal` | 创建 topic，初步设计 |
| `proposal → ongoing` | 预检通过，wave 准入 |
| `ongoing` | 多个 wave 顺序推进，每个完成 closeout |
| `ongoing → pending` | 等待外部依赖 / 用户验收 |
| `pending → ongoing` | 外部依赖满足，新 wave 准入 |
| `ongoing → closed` | 所有 wave 关闭，完成 topic 级 closeout |
| `closed (true_close_status: not_started)` | 文件夹已关闭，但 true close 尚未记录 |
| `true_close_pending → true_closed` | 独立审计核验 true close 通过 |

整条轨迹可通过 `topic.yaml` 与审计记录观察。

## 场景：一个已关闭的 topic 被重开

某个已关闭 topic 之后被发现存在严重问题。

1. **topic 已关闭**，true closed。
2. **独立审计发现问题**：true close 不应该通过。
3. **撤销 true close**：`current_true_close_status: revoked`。
4. **要求后续血缘**：新建一个修复 topic，血缘指向被撤销的 true close。
5. **原 topic 仍保持 closed 状态**，并附带撤销记录；修复由新 topic 承担。

撤销不会抹除历史，而是新增一条强类型证据记录。

## 场景：等待触发 close 的 pending 状态

某个 topic 已完成所有计划 wave，但 true close 尚不能进行——还在等用户验收。

1. **所有 wave 关闭**，每个都做了 wave 级 closeout。
2. **进入 pending 状态**：`topic.yaml.state: pending`。
3. **pending-note 写明 close_trigger**：例如"用户显式接受已渲染的文档"。
4. **重开条件显式**：例如"用户反馈文档仍然不达标，本 topic 下准入修复 wave"。
5. **用户复核**：要么接受（进入 true close 路径），要么暴露阻塞（准入新 wave）。

pending-note 是结构化的等待。不存在"它就这么放着"这种隐式状态。

## 来源依据

- [`nimi-coding/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle.yaml)
- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/true-close.schema.yaml)
- [`nimi-coding/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/pending-note.schema.yaml)
