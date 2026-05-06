# 怎么处理 pending acceptance

你的 wave 按机器标准闭了但人审接受度没记。你不确定该 true-close 还是等。

## 菜谱

1. **不**把 topic 搬到 `closed`。 留在 `pending`。
2. **记一份显式 pending-note** 带 `close_trigger` 与 `reopen_criteria`。
3. **把 wave 的 `consumer_closure: closed_pending_user_acceptance`**（**不是** `closed`）。这是诚实的维度状态。
4. **显式写 wave 审计残余风险。** 审计裁定对机器可观测标准能 PASS，但审计本身记「最终消费方接受度仍要人审」。
5. **等。** Pending 是带显式重开标准的真状态；它**不是**「卡住」。
6. **用户 review 时：**
   - 接受 → 走 true-close 仪式。
   - 带新 finding 拒 → 在同一 topic 下准入 remediation wave。
   - 带结构 finding 拒 → 准入下个 wave 前重看 topic.yaml wave deps。

## 记 pending-note 的菜谱

```yaml
---
pending_note_id: pending-<topic-id>
topic_id: <topic-id>
entered_from_state: ongoing
reason: awaiting-human-docs-acceptance
summary: |
  <一段事实摘要：完成了什么、为什么在等>
status: active
reopen_criteria: |
  <什么用户反馈会触发重开 — 具体>
close_trigger: |
  <什么用户动作会触发 true-close — 通常是「显式接受」>
---

# Pending Note

<上面的人可读扩展>
```

重开标准与 close trigger 必须显式。「最终用户会看一下这个」**不是**标准。

## 阅读场景：Wave 闭了、用户没 review

你跑了文档重写 wave。审计过了。用户还没 review 渲染输出。

| 步骤 | 动作 |
| --- | --- |
| Topic 状态 | `ongoing → pending` |
| Wave 状态 | `closed` |
| Wave consumer_closure | `closed_pending_user_acceptance` |
| Pending-note close_trigger | 「用户显式接受渲染文档」 |
| Pending-note reopen_criteria | 「用户报告渲染文档不达接受线」 |

现在：等。**别** true-close。**别**没准入就继续做相邻项。

## 阅读场景：用户 review 并接受

用户确认文档可接受。

| 步骤 | 动作 |
| --- | --- |
| Topic 状态 | `pending → closed`（在 topic-true-close 仪式里） |
| current_true_close_status | `not_started → passed`（带审计） |
| Topic-true-close-audit | 已记 |
| 文件夹 | 把 topic 搬到 `.nimi/topics/closed/...` |

接受度授权了搬动。

## 阅读场景：用户 review 并拒

用户说文档在某具体区域还要工作。

| 步骤 | 动作 |
| --- | --- |
| Topic 状态 | 留 `pending`（或作为准入下个 wave 的一部分搬回 `ongoing`） |
| 准入 remediation wave | 新 wave 带反映用户具体反馈的 `acceptance_invariants` |
| Wave deps | 引闭合的之前 wave |
| Pending-note | 更新反映新等待条件 |

用户反馈驱动下个 wave 的不变量。方法学把「用户说不好」转成「下个 wave 接受度是 X」。

## 阅读场景：错误 — Topic 提早搬到 closed

你因所有 wave 都闭了就把 topic 文件夹搬到 `.nimi/topics/closed/`，但用户还没接受。

| 步骤 | 恢复 |
| --- | --- |
| 检查 `current_true_close_status` | 如果 `not_started`，topic 没正确 true-closed |
| Topic 搬回 `pending` | 文件夹 + topic.yaml |
| 记显式 pending-note | 它该是的样子 |
| 记 `last_transition_reason: rolled_back_premature_topic_close_to_pending_for_user_acceptance` | 审计记录 |

提早 true-close 本身是伪闭合模式。恢复是撤销搬动并记修正。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| Topic 搬到 closed 没 true-close 审计 | 提早；回滚 |
| Wave consumer_closure 标 `closed` 没用户 review | 软通过；调和到 `closed_pending_user_acceptance` |
| Pending 状态没 pending-note | 规则违反；建显式 pending-note |
| Pending-note 没 close_trigger | 软；带显式 trigger 重写 |

## 来源

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/closeout.schema.yaml)
- [`.nimi/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/pending-note.schema.yaml)
- [`.nimi/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/true-close.schema.yaml)
