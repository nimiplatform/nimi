# Topic 生命周期

一个 topic 是一条权威承担类或高风险工作的主线迭代之家。这一页讲它的状态机：粗粒度生命周期（`proposal → ongoing → pending → closed`），加上细粒度 wave 状态，再加上独立于 topic state 的 true-close 状态。

工作怎么沿着状态机推进，请看 [Topic Workflow](/zh/nimicoding/topic-workflow)。

## 粗粒度生命周期

| 状态 | 含义 |
| --- | --- |
| `proposal` | 主动期前的规划 |
| `ongoing` | 正在执行 |
| `pending` | 暂停，等证据或外部触发 |
| `closed` | 已不再是当前主线 |

状态记录在 `topic.yaml`。文件夹位置跟随状态；只搬文件夹**不算**状态证据 —— `topic.yaml` 才是。

## 细粒度状态

粗粒度之外还有更细的机器状态：

| 细状态 | 粗状态 |
| --- | --- |
| `design_only` | proposal / ongoing |
| `implementation_ready` | ongoing |
| `implementation_active` | ongoing |
| `true_close_pending` | pending / closed |
| `true_closed` | closed |
| `revoked` | closed（但可撤销） |
| `superseded` | closed |

细状态可以从 topic 工件和审计记录里观察到。

## 转移规则

允许的转移：

| 起点 → 终点 | 备注 |
| --- | --- |
| `proposal → ongoing` | 要 preflight、要选定一个 next target、要边界 stop line、要消化过的输入、要预期的 closeout 检查、要显式的 forbidden reopen |
| `ongoing → pending` | 要没有正在跑的实现 wave，要一份带 reopen 条件或 close 触发器的 pending-note |
| `pending → ongoing` | 重启工作；需要新的 wave 准入 |
| `ongoing → closed` | 所有已闭 wave 各有 wave-level closeout；topic-level closeout 写最终归属 |
| `pending → closed` | 同 ongoing → closed |
| `proposal → closed` | 没实现就闭 |
| `closed → ongoing` | 需要显式 reopen，不是顺手的修改 |
| `ongoing → proposal` | 从主动期回到规划 |

禁止：

- 平行 topic 副本（同一时刻只有一份规范化副本）。

## Wave 状态

Topic 内部 wave 有自己的状态机。

| Wave 状态 | 终态？ |
| --- | --- |
| `candidate` | 否 |
| `preflight_draft` | 否 |
| `preflight_admitted` | 否 |
| `implementation_admitted` | 否 |
| `implementation_active` | 否 |
| `needs_revision` | 否 |
| `overflowed` | 否（要么显式 continuation，要么修改） |
| `continuation_packet_open` | 否 |
| `closed` | 是 |
| `retired` | 是 |
| `superseded` | 是 |

retired 或 superseded 的 wave 不可 dispatch。`overflowed` 的 wave 不会自动被当成 `closed` —— overflow continuation 必须显式准入。

## True Close

True close **跟 topic 状态是 `closed` 不是一回事**。一个 topic 可以文件夹搬过去 closed 但还没 true-close；true close 要单独一份审计记录，证明这次闭合通过了独立验证。

| `current_true_close_status` | 含义 |
| --- | --- |
| `not_started` | True close 还没开始 |
| `pending` | True close 进行中 |
| `true_closed` | True close 通过 |
| `revoked` | 通过的 true close 被后来的独立审计撤销 |
| `superseded` | True close 被后来的准入超越 |

通过的 true close 自身也可能被后来的独立审计撤销；撤销之后要补一份后续 lineage。这就是为什么上一次的公开文档 topic 能在机器侧 true-close 之后，又因为人工接受度没过而被 remediate。

## 五层闭合

完整的 closeout 纪律有五种不同的证据面：

| 层 | 它涵盖什么 |
| --- | --- |
| Context closure | 一段 context 已经到了一个稳定的规划 stop line |
| Wave closeout | 一个准入的 wave 在它的 stop line 上拿到了边界证据（四个闭合维度） |
| Pending hold | Topic 在没主动开发的情况下等待，但保留显式的 reopen 或 close 标准 |
| Topic closeout | Topic 已经不是当前主线 |
| True close | Topic 经独立审计核验过 finished |

这五层必须保持**互相区分**。把 wave closeout 跟 topic closeout 合在一起、或把 topic closeout 当 true close 来用，都会丢信息。

## 阅读场景：一个 topic 的完整轨迹

一个真做了实质 AI 工作的 topic 大致长这样：

| 阶段 | 发生什么 |
| --- | --- |
| `proposal` | Topic 创建；初步设计 |
| `proposal → ongoing` | Preflight 完成；wave 准入 |
| `ongoing` | 多个 wave 顺序跑；各自闭合 |
| `ongoing → pending` | 等外部依赖 / 用户接受度 |
| `pending → ongoing` | 外部依赖到位；新的 wave 准入 |
| `ongoing → closed` | 所有 wave 闭合；topic-level closeout |
| `closed (true_close_status: not_started)` | 文件夹闭了，true close 还没记 |
| `true_close_pending → true_closed` | 独立审计核验过 true close |

整条轨迹通过 `topic.yaml` 与审计记录就能看清楚。

## 阅读场景：已闭 topic 被重新打开

一个已闭 topic 后来被发现有严重问题。

1. **已闭 topic 在。** True closed。
2. **独立审计露出问题。** True close 本不该过。
3. **True close 被撤销。** `current_true_close_status: revoked`。
4. **要求后续 lineage。** 一个新的 topic 来 admit remediation；lineage 链回被撤销的那次 true close。
5. **原 topic 留在闭合状态**，附带撤销记录；remediation 由新 topic 来做。

撤销不抹掉历史，它只是再加一条类型化证据记录。

## 阅读场景：带 close trigger 的 pending

一个 topic 把计划内的 wave 都做完了，但还没法 true-close —— 还要等用户接受度。

1. **所有 wave 都闭。** 每一个都有 wave-level closure。
2. **进入 pending。** `topic.yaml.state: pending`。
3. **Pending-note 写下 close_trigger。** 「用户显式接受渲染出的文档」。
4. **Reopen 标准显式。** 「用户反馈文档仍然不到位；在本 topic 下准入 remediation wave」。
5. **用户审过。** 要么接受（走向 true-close），要么暴露 blocker（准入新 wave）。

Pending-note 是结构化的等待。这里没有「就是先放着」这种含混状态。

## 来源

- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/true-close.schema.yaml)
- [`.nimi/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/pending-note.schema.yaml)
