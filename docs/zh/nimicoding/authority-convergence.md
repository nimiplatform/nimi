# 权威收敛

权威收敛是这样一道关：当 packet 触到 authority / spec / redesign 类表面，**必须在 dispatch 实现之前就有一份独立审计 PASS 的记录**。这是方法论结构性挡住 AI 自行改 spec 漂移的那道闸。

## 这道关在什么条件下触发

| 触发因素 | 命中条件 |
| --- | --- |
| `packet_kind` | `authority`、`spec`、`redesign`、或 `preflight` |
| `ref_prefix` | `.nimi/spec/` |
| `topic.work_type` | `redesign` |

任意一项命中，关就启动。dispatch worker 之前必须先有一份独立 auditor 的 PASS。

## 必须的结果形态

| 字段 | 值 |
| --- | --- |
| `result_kind` | `audit` |
| `verdict` | `PASS`（唯一被准入的通过裁定） |

`NEEDS_REVISION` 与 `FAIL` 是 blocking 裁定。裁定没移到 `PASS` 之前，dispatch 不会发生。

## 落地后复审

实现落地之后，机械相变之前还要再过一道 follow-up judgement PASS。

| 字段 | 值 |
| --- | --- |
| `result_kind` | `judgement` |
| `verdict` | `PASS` |

落地后这道判断跟实现前那道审计是两道分开的关。两道都得过。

## 为什么要两道关

实现前的审计能抓的是：

- 拟议改动里的漂移（这次 spec 编辑讲得通吗？）
- 暗中的权威迁移（规范化真相是不是被悄悄搬了家？）
- 设计中已经埋下的禁用模式。

实现后的判断能抓的是：

- 计划与执行之间的漂移（worker 做的真是计划里要做的吗？）
- 实现层引入的、实现前审计看不见的模式（执行中临时塞进的捷径）。
- 跨四个维度的最终闭合核验。

只一道关只能抓住一半。两道关把两半都抓住。

## 硬约束

| 约束 | 它禁止什么 |
| --- | --- |
| Auditor 输出仅是候选证据 | Auditor 不能自我准入 |
| 实现 dispatch 之前 manager 必须把审计结果记下来 | Manager 不能跳过登记 |
| 未解决的 blocking finding 走 fail-close | 不能挥手就把一个 blocker 抹掉 |
| 推迟的事项必须显式标记成非 blocking | 不能把 blocker 偷偷塞进「以后」里 |
| 具体的 subagent 机制属于 adapter profile，不属于方法论语义 | 方法论保持宿主无关 |

最后一条就是宿主无关原则：审计怎么被路由到另一段 AI session，是 adapter 的事，不是方法论的事。

## 阅读场景：没做实现前审计就想 dispatch

某 worker 想 dispatch 一份会编辑 `.nimi/spec/` 的 packet，可没有实现前审计的记录。

1. **Manager 评估 dispatch。** 权威收敛门启动。
2. **查审计。** 关去找 `result_kind: audit` + `verdict: PASS` 的记录。
3. **找不到。** 这份 packet 没有审计记录。
4. **拒绝 dispatch。** Worker 不被派出去。
5. **后续路径。** 跑实现前审计；记录 PASS；重新提交 dispatch。

跳是跳不掉的。这道关是结构性的。

## 阅读场景：实现前审计返回 NEEDS_REVISION

实现前审计跑完了，返回 `NEEDS_REVISION`，附带具体 finding。

1. **审计已记录。** `result_kind: audit, verdict: NEEDS_REVISION`。
2. **Finding 被点出。** 具体的漂移 / 禁用模式问题。
3. **Worker dispatch 被拒。** `NEEDS_REVISION` 是 blocking 裁定。
4. **Manager 处理 finding。** 要么修 packet（新的 `forbidden_shortcuts`、收窄范围等），要么解决底层问题（先准入缺失的前置）。
5. **重新审计。** 跑新的实现前审计；这次 PASS 才能 dispatch。

Finding 决定下一份 packet 怎么改。没有「审计说 no、我们还是动手」这条路。

## 阅读场景：落地后判断抓到漂移

实现落地了。实现前审计 PASS 已记录。Worker 报「做完了」。

1. **落地后判断。** 独立循环 review 实际的工作。
2. **检测到漂移。** Worker 引入了一个实现前审计预见不到的 `dual_read` 模式。
3. **裁定。** `judgement: NEEDS_REVISION`。
4. **Wave 退回修改。** 判断 PASS 之前，wave 不能进入机械相变。
5. **Worker 处理。** 删掉 `dual_read`，重新提交。
6. **重新判断 PASS。** Wave 才能继续推进。

实现层的漂移被抓到，正是因为落地后这道关有它自己的关位。

## 阅读场景：spec 更新复审门

某 packet 成功实现了一次 spec 改动，实现前审计 PASS 与落地后判断 PASS 都有记录。机械相变本来可以正常进行。

但有一条特别规则：**spec 更新复审是机械相变继续的例外**。一次 spec / authority / redesign 实现 PASS 之后，下一步执行必须用 `require_human_confirmation`，理由码 `spec_update_review_required`，直到一份新的 judgement PASS 被记录下来。

这条规则存在的理由：spec 改动的后果足够大，即便机械上看着干干净净的实现，也要在下一阶段推进之前先过一道人工确认的关。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 实现前审计 | 独立 auditor |
| 审计结果登记 | Manager |
| Worker dispatch 决定 | Manager（审计 PASS 之后） |
| 落地后判断 | 独立 auditor |
| 机械相变 | Manager（判断 PASS 之后，且通过 spec 更新复审门） |

## 来源

- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/decision-review.schema.yaml)
