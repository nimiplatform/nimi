# 处理 Pending Acceptance

Wave 已经按机器标准关闭，但用户尚未给出明确确认。你不确定该 true-close 还是继续等。

## 步骤

1. **不要把 topic 转入 `closed`。** 留在 `pending`。
2. **写一份明确的 pending-note**，包含 `close_trigger` 与 `reopen_criteria`。
3. **把该 wave 的 `consumer_closure` 标记为 `closed_pending_user_acceptance`**（不是 `closed`）。这是诚实的状态。
4. **把 wave 的审计残余风险写明白。** 机器可观测项的审计裁决可以是 PASS，但审计本身要注明"最终消费者确认仍需人工复核"。
5. **等。** Pending 是有明确 reopen 条件的真实状态，不是"卡住了"。
6. **当用户给出复核结论：**
   - 接受 → 走 true-close 流程。
   - 拒绝并附上新发现 → 在同一 topic 下准入修复 wave。
   - 拒绝并指出结构性问题 → 在准入下一个 wave 前重审 topic.yaml 中的 wave 依赖关系。

## Pending-note 的写法

```yaml
---
pending_note_id: pending-<topic-id>
topic_id: <topic-id>
entered_from_state: ongoing
reason: awaiting-human-docs-acceptance
summary: |
  <用一段话客观说明已完成什么、为什么在等>
status: active
reopen_criteria: |
  <什么样的用户反馈会触发 reopen——写具体>
close_trigger: |
  <什么样的用户动作会触发 true-close——通常是
  "明确接受">
---

# Pending Note

<上述结构的人类可读展开>
```

reopen 条件与 close 触发条件必须写明确。"用户迟早会看的"不是合格条件。

## 场景：Wave 已关闭，用户未复核

你跑了一个文档重写 wave，审计 PASS，用户尚未看渲染结果。

| 步骤 | 操作 |
| --- | --- |
| Topic 状态 | `ongoing → pending` |
| Wave 状态 | `closed` |
| Wave consumer_closure | `closed_pending_user_acceptance` |
| Pending-note close_trigger | "用户明确接受渲染后的文档" |
| Pending-note reopen_criteria | "用户反馈渲染后的文档不达标" |

接下来：等。不要 true-close。也不要在没有准入的情况下继续做相邻条目。

## 场景：用户复核并接受

用户确认文档可以接受。

| 步骤 | 操作 |
| --- | --- |
| Topic 状态 | `pending → closed`（在 topic-true-close 流程中） |
| current_true_close_status | `not_started → passed`（带审计） |
| Topic-true-close-audit | 已记录 |
| 文件夹 | 把 topic 移到 `.nimi/topics/closed/...` |

是用户的接受授权了这次状态迁移。

## 场景：用户复核并拒绝

用户指出文档在某个具体方向还需要修。

| 步骤 | 操作 |
| --- | --- |
| Topic 状态 | 留在 `pending`（或在准入下一个 wave 时回到 `ongoing`） |
| 准入修复 wave | 新 wave 的 `acceptance_invariants` 反映用户给出的具体反馈 |
| Wave deps | 引用上一个已关闭的 wave |
| Pending-note | 更新到反映新的等待条件 |

用户反馈直接驱动下一 wave 的不变式。方法学把"用户说不行"翻译成"下一 wave 的验收标准是 X"。

## 场景：误把 topic 提前关闭

所有 wave 都关闭了，于是你顺手把 topic 文件夹挪到了 `.nimi/topics/closed/`，但用户其实没确认。

| 步骤 | 恢复 |
| --- | --- |
| 检查 `current_true_close_status` | 如果是 `not_started`，说明 topic 没经过正确 true-close |
| 把 topic 移回 `pending` | 文件夹与 topic.yaml 一起 |
| 补写明确 pending-note | 还原它本应有的样子 |
| 记录 `last_transition_reason: rolled_back_premature_topic_close_to_pending_for_user_acceptance` | 留下审计痕迹 |

提前 true-close 本身就是一种伪关闭模式。恢复办法是撤销移动并把更正记下来。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 没有 true-close 审计就把 topic 转到 closed | 提前；回滚 |
| 用户未复核却把 wave consumer_closure 标 `closed` | 软通过；改回 `closed_pending_user_acceptance` |
| 处于 pending 但缺 pending-note | 违规；补一份明确的 pending-note |
| Pending-note 缺 close_trigger | 软；重写并写明触发条件 |

## 来源依据

- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/closeout.schema.yaml)
- [`nimi-coding/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/pending-note.schema.yaml)
- [`nimi-coding/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/true-close.schema.yaml)
