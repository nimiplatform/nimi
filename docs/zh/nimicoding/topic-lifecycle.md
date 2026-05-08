# Topic 生命周期 (Topic Lifecycle)

Topic 是承载高风险或涉及架构权威变更的主线迭代的容器。本页将详细解析 Topic 的状态机模型：包括宏观生命周期（`proposal → ongoing → pending → closed`）、更细粒度的 Wave 状态，以及独立于 Topic 状态之外的“真正闭合（True-close）”状态。

关于工作如何在这些状态中流转的具体操作，请参阅 [Topic 工作流](/zh/nimicoding/topic-workflow)。

## 宏观生命周期

| 状态 | 核心含义 |
| --- | --- |
| `proposal` | 提案阶段：进入活跃执行前的规划过程。 |
| `ongoing` | 执行阶段：任务正在活跃进行中。 |
| `pending` | 挂起阶段：任务暂时停滞，等待关键证据或外部触发条件。 |
| `closed` | 已关闭：不再是当前的活跃主线任务。 |

Topic 的状态显式记录在 `topic.yaml` 中。文件夹的位置应该随着状态的变化而移动，但**仅仅移动文件夹并不能代表状态发生了变更**——一切必须以 `topic.yaml` 中的记录为准。

## 微观状态

在宏观状态之下，系统还追踪更细粒度的机器状态：

| 微观状态 | 归属的宏观状态 |
| --- | --- |
| `design_only` | proposal / ongoing |
| `implementation_ready` | ongoing |
| `implementation_active` | ongoing |
| `true_close_pending` | pending / closed |
| `true_closed` | closed |
| `revoked` | closed（已关闭，但闭合结论被撤销） |
| `superseded` | closed（被后续工作替代） |

这些细粒度的状态可以通过 Topic 内部的工件（Artifacts）和审计记录（Audit Records）来进行观察。

## 状态流转规则

允许的流转路径：

| 起点 → 终点 | 核心要求 |
| --- | --- |
| `proposal → ongoing` | 必须完成 Preflight（预检），选定唯一的下一个执行目标，划定止损线，消化所有输入，明确验收核验项，并显式列出禁止重新开启的条件。 |
| `ongoing → pending` | 当前不能有活跃执行的 Wave；必须附带一份 `pending-note`（挂起说明），写明重开（Reopen）条件或闭合触发器（Close trigger）。 |
| `pending → ongoing` | 恢复工作；需要完成新的 Wave 准入流程。 |
| `ongoing → closed` | 确保所有已执行的 Wave 都具备 Wave 级别的闭合记录；并产出 Topic 级别的收尾记录，说明最终处置结果。 |
| `pending → closed` | 与 `ongoing → closed` 相同。 |
| `proposal → closed` | 在未进入实现阶段的情况下直接关闭。 |
| `closed → ongoing` | 必须经过显式的重开（Reopen）决策，严禁以“顺手改一点”的名义进行非正式修改。 |
| `ongoing → proposal` | 从活跃执行状态退回重新规划。 |

**严禁行为**：系统中同一时刻只能存在一份唯一的 Topic 真相副本，严禁保留平行的副本。

## Wave 状态

在 Topic 内部，Wave 拥有独立的状态机：

| Wave 状态 | 是否为终态？ |
| --- | --- |
| `candidate` | 否 |
| `preflight_draft` | 否 |
| `preflight_admitted` | 否 |
| `implementation_admitted` | 否 |
| `implementation_active` | 否 |
| `needs_revision` | 否（需要打回修改） |
| `overflowed` | 否（需要显式准入延续包，或进行修正） |
| `continuation_packet_open` | 否 |
| `closed` | **是** |
| `retired` | **是** |
| `superseded` | **是** |

被标记为 `retired`（已废弃）或 `superseded`（被替代）的 Wave 不能被分发执行。处于 `overflowed`（已溢出）状态的 Wave 不会被静默转为 `closed`——溢出后必须显式地准入延续包（continuation）。

## 真正闭合 (True Close)

**True Close 与 Topic 自身的 `closed` 状态是完全不同的概念。** 一个 Topic 的文件夹可以被移动到已关闭目录，但这并不意味着它已经通过了 True Close。True Close 需要一份单独的审计记录，以此证明该任务的闭合经过了外部循环的独立验证。

| `current_true_close_status` | 含义 |
| --- | --- |
| `not_started` | True close 尚未开始审计。 |
| `pending` | True close 正在审计中。 |
| `true_closed` | **True close 已通过独立审计。** |
| `revoked` | 原本通过的 True close 被后续的独立审计撤销。 |
| `superseded` | True close 被后来准入的工作所替代。 |

已经通过的 True close 也有可能被后续的独立审计撤销；一旦被撤销，必须补齐后续的追溯链条（Lineage）。正是因为这项机制，我们在处理早期的文档 Topic 时，即使机器层面已经闭合，也能在人类接受度不达标时被重新“追责”和修复。

## 五层闭合证据体系

完整的收尾（Closeout）纪律包含五个独立层面的证据：

| 证据层 | 覆盖范围 |
| --- | --- |
| 上下文闭合 (Context closure) | 某个上下文已收敛至稳定的规划止损线。 |
| Wave 闭合 (Wave closeout) | 单个获准入的 Wave 在其止损线上，拿到了四个维度的闭合证据。 |
| 挂起等待 (Pending hold) | Topic 在没有活跃开发的情况下挂起，但保留了明确的重开或闭合标准。 |
| Topic 闭合 (Topic closeout) | 该 Topic 不再是当前的活跃主线任务。 |
| 真正闭合 (True close) | Topic 经过独立审计核验，确认已彻底完成。 |

这五层证据必须**保持严格区分**。把 Wave 闭合混淆为 Topic 闭合，或者把 Topic 闭合直接当成 True Close，都会导致关键审计信息的丢失。

## 场景案例：一个 Topic 的完整生命周期

一个深度依赖 AI 辅助编码的 Topic，其典型运转轨迹如下：

| 阶段 | 发生了什么 |
| --- | --- |
| `proposal` | 创建 Topic；进行初步架构设计。 |
| `proposal → ongoing` | 完成 Preflight（预检）；首个 Wave 获准入。 |
| `ongoing` | 依次执行多个 Wave；每个 Wave 执行完毕后独立闭合。 |
| `ongoing → pending` | 等待外部依赖（如 API 就绪）或用户验收结果。 |
| `pending → ongoing` | 外部依赖已满足；新的 Wave 获准入。 |
| `ongoing → closed` | 所有 Wave 均已闭合；生成 Topic 级别的收尾记录。 |
| `closed` (未开始 true close) | 文件夹已移入 closed，但尚未进行 True close 审计。 |
| `true_close_pending → true_closed` | 独立审计介入，核验无误，记录 True close 已通过。 |

整个状态流转过程完全可以通过 `topic.yaml` 及各项审计记录被清晰观察到。

## 场景案例：已关闭的 Topic 被重新撤销

某个 Topic 在很久之后被发现存在严重问题：

1. **存在已关闭的 Topic**：状态为 True closed。
2. **独立审计发现问题**：确认当年的 True close 属于误判，本不该通过。
3. **撤销 True close**：将其状态更新为 `current_true_close_status: revoked`。
4. **追溯修复链条（Lineage）**：发起一个新的 Topic 来承接修复工作，并在追溯链条中链接回那个被撤销的 True close。
5. **原始 Topic 维持在 closed 状态**，只补充撤销记录；修复工作全部在新的 Topic 中完成。

撤销并不会抹除历史，而是追加了一份类型化的证据记录。

## 场景案例：带有闭合触发条件的挂起状态

一个 Topic 已经完成了所有规划好的 Wave，但还不能直接 True close——因为它需要等待人类的最终验收。

1. **所有 Wave 已闭合**：每个 Wave 都有各自的闭合记录。
2. **进入挂起状态**：更新为 `topic.yaml.state: pending`。
3. **挂起说明记录触发器**：“当用户显式接受渲染后的文档时闭合。”
4. **重开条件明确**：“如果用户反馈文档仍不合格，则在此 Topic 下准入新的修复 Wave。”
5. **用户审阅**：用户如果接受（则走向 True close 路径）；如果提出阻碍问题（则准入新的 Wave）。

挂起说明（Pending-note）是一种“结构化等待”。在 Nimi Coding 中，不存在“任务就这么静静地躺在那儿没人管”的模糊状态。

## 来源依据

- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/true-close.schema.yaml)
- [`.nimi/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/pending-note.schema.yaml)
