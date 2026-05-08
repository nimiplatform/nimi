# 权威收敛

权威收敛是这样一道关卡：当某个 packet 触及权威 / 规范 / 重设计面时，**实施派发之前必须有一份独立审计 PASS 在册**。这是方法论用以阻止 AI 改写规范的结构性保障。

## 什么时候触发

| 触发条件 | 匹配规则 |
| --- | --- |
| `packet_kind` | `authority`、`spec`、`redesign`、`preflight` 之一 |
| `ref_prefix` | `.nimi/spec/` |
| `topic.work_type` | `redesign` |

任何一项命中，关卡即生效。worker 派发之前必须先有独立审计员的 PASS。

## 必备结果

| 字段 | 取值 |
| --- | --- |
| `result_kind` | `audit` |
| `verdict` | `PASS`（仅此一种通过裁决） |

`NEEDS_REVISION` 与 `FAIL` 都是阻塞裁决。worker 派发要等到裁决推进到 `PASS` 才会发生。

## 实施后复核

实施落地之后，再过一次"判定 PASS"，机械相位转换才能继续。

| 字段 | 取值 |
| --- | --- |
| `result_kind` | `judgement` |
| `verdict` | `PASS` |

实施后判定与实施前审计是两道独立关卡，两者都必须通过。

## 为什么需要两道关卡

实施前审计抓的是：

- 提议改动本身的漂移（这次规范编辑是否合理？）
- 隐性的权威转移（权威真相是否在被搬动？）
- 计划方案中的禁用模式。

实施后判定抓的是：

- 计划与执行之间的漂移（worker 做的是不是计划的事？）
- 实施层的模式（执行过程中冒出来的快捷方式），这一类实施前审计看不到。
- 四个维度上的最终闭合核验。

只有一道关卡，会漏掉一半。两道关卡，两半都能抓到。

## 硬约束

| 约束 | 它禁止什么 |
| --- | --- |
| 审计员输出仅作候选证据 | 审计员不得自我准入 |
| 管理者在派发实施之前记录审计结果 | 管理者不得跳过记录步骤 |
| 未解决的阻塞性发现 fail-closed | 阻塞项不得被一笔带过 |
| 推迟项必须显式标记为非阻塞 | 不得把阻塞项悄悄推到"以后" |
| 子代理具体机制归适配器档案，不归方法论语义 | 方法论保持宿主无关 |

最后一条体现宿主无关原则：审计如何被路由到另一个 AI 会话，是适配器关切，不是方法论关切。

## 读者场景：未走实施前审计的规范编辑

worker 想派发一个编辑 `.nimi/spec/` 的 packet，但没有实施前审计在册。

1. **管理者评估派发。**权威收敛关卡触发。
2. **查找审计。**关卡核对是否有 `result_kind: audit` 且 `verdict: PASS`。
3. **未找到。**该 packet 没有审计在册。
4. **拒绝派发。**worker 不会被派发。
5. **下一步。**先跑实施前审计；记录 PASS；再次提交派发。

不存在跳过的路径。这道关卡是结构性的。

## 读者场景：实施前审计返回 NEEDS_REVISION

实施前审计跑完，返回 `NEEDS_REVISION`，附带具体发现。

1. **审计已记录。**`result_kind: audit, verdict: NEEDS_REVISION`。
2. **发现已记录。**具体的漂移 / 禁用模式问题。
3. **拒绝派发 worker。**`NEEDS_REVISION` 是阻塞裁决。
4. **管理者处置发现。**要么修订 packet（新增 `forbidden_shortcuts`、收窄范围等），要么解决底层问题（先准入缺失的前置项）。
5. **复审。**再跑一次实施前审计；如果这次 PASS，则派发。

这些发现驱动 packet 的下一次修订。不存在"审计说不、但我们继续"的路径。

## 读者场景：实施后判定抓到漂移

实施落地。实施前审计 PASS 已记录。worker 报告"完成"。

1. **实施后判定。**独立回路审看实际工作。
2. **检测到漂移。**worker 在过程中引入了一处 `dual_read`，这一类是实施前审计无法预见的。
3. **裁决。**`judgement: NEEDS_REVISION`。
4. **wave 退回修订。**判定未到 PASS 之前，不能进入机械相位转换。
5. **worker 处置。**移除 `dual_read`，重新提交。
6. **再判定 PASS。**这次 wave 才能继续推进。

实施层的漂移之所以会被抓到，是因为实施后判定本身就是一道独立关卡。

## 读者场景：规范更新复核关卡

某个 packet 成功实施了一次规范变更，实施前审计 PASS 与实施后判定 PASS 都已记录。按一般规则，机械相位转换可以继续。

但有一条特殊规则：**实施后规范更新复核是机械相位转换续作的例外**。一次规范 / 权威 / 重设计实施 PASS 之后，run-next-step 必须使用 `require_human_confirmation`，原因码为 `spec_update_review_required`，直到一份新的判定 PASS 被记录。

这条规则之所以存在，是因为规范变更的后果足够重大——即使机械上干净的实施，下一阶段推进前也需要一道"人工确认"关卡。

## 边界归属

| 关切 | 归属 |
| --- | --- |
| 实施前审计 | 独立审计员 |
| 审计结果记录 | 管理者 |
| worker 派发决策 | 管理者（在审计 PASS 之后） |
| 实施后判定 | 独立审计员 |
| 机械相位转换 | 管理者（在判定 PASS 之后，附规范更新复核关卡） |

## Source Basis

- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/decision-review.schema.yaml)
