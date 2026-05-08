# 权威收敛 (Authority Convergence)

权威收敛是一道刚性关口，它的核心要求是：当一个工作包（Packet）触及权威、规范（Spec）或重新设计等相关层面时，**在向执行者（Worker）分派任务之前，必须先获得独立审计的 PASS（通过）记录**。这是 Nimi Coding 方法论中，用来防止 AI 在无形中篡改设计规范的一道结构性防线。

## 触发关口的条件

只要满足以下任一条件，关口就会被触发：

| 触发维度 | 命中条件 |
| --- | --- |
| `packet_kind` | 类型为 `authority`、`spec`、`redesign` 或 `preflight` |
| `ref_prefix` | 引用了以 `.nimi/spec/` 为前缀的路径 |
| `topic.work_type` | `redesign` |

一旦命中，在分派 Worker 执行任务之前，就必须先获取独立审计员（Auditor）出具的 PASS 结论。

## 审计结果的唯一合法形态

| 字段 | 必须值 |
| --- | --- |
| `result_kind` | `audit` |
| `verdict` | `PASS`（这是唯一被允许的分派通行裁定） |

若审计裁定为 `NEEDS_REVISION`（需修订）或 `FAIL`（失败），则会阻塞分派。在裁定转为 `PASS` 之前，任务的执行分派将永远不会发生。

## 落地后的二次评审

在代码实现落地之后，系统推进机械相变（Mechanical phase transition）之前，还需要经过一道后续评审：

| 字段 | 必须值 |
| --- | --- |
| `result_kind` | `judgement` |
| `verdict` | `PASS` |

落地后的评审（Judgement）与实现前审计（Audit）是两道完全分离的关口。想要顺利推进，这两道关口都必须通过。

## 为什么需要两道关口？

实现前审计（Pre-implementation audit）用于捕捉：
- 提议的变更中是否存在设计漂移（例如，这次对规范的修改在逻辑上合理吗？）；
- 隐蔽的权威转移（例如，规范事实源是否被悄悄挪移了位置？）；
- 计划方案中是否潜藏着禁用模式（Forbidden patterns）。

落地后判断（Post-implementation judgement）用于捕捉：
- 计划与实际执行之间的偏差（例如，Worker 实际做的是否与原计划一致？）；
- 实现阶段引入的、实现前审计无法预见的模式（例如，执行过程中临时塞入的捷径）；
- 在四个闭合维度上的最终收尾核验。

单一关口只能防住一半风险；只有双重关口才能做到全程无死角防范。

## 刚性约束

| 约束 | 所禁止的行为 |
| --- | --- |
| 审计者的输出仅作为候选证据 | 审计者无权自行决定准入 |
| 管理者必须在分派前记录审计结果 | 管理者严禁跳过结果登记步骤 |
| 未解决的阻塞性发现将导致立即中止（Fail closed） | 严禁对阻碍项视而不见 |
| 暂缓处理的事项必须明确标记为非阻塞 | 严禁暗中把阻塞性问题推脱到“以后再说” |
| 具体的 Subagent 运作机制属于适配器配置，而非方法论语义 | 方法论必须保持宿主无关（Host-agnostic） |

最后一条约束体现了“宿主无关”的核心原则：如何将审计请求路由给不同的 AI 会话，这是适配器（Adapter）需要关心的事，而不是方法论需要定义的事。

## 场景案例：没有前置审计就尝试修改规范

一个 Worker 试图分派一个包含修改 `.nimi/spec/` 的 Packet，但在记录中并未发现实现前的审计结果。

1. **管理者评估分派**：权威收敛关口被触发。
2. **审计记录核查**：关口检查是否存在 `result_kind: audit` 且 `verdict: PASS` 的记录。
3. **未发现记录**：该 Packet 没有相应的审计记录。
4. **拒绝分派**：阻止 Worker 执行该任务。
5. **后续路径**：运行实现前审计；记录 PASS 结论；重新提交分派请求。

这是一个刚性的结构化关口，没有任何跳过选项。

## 场景案例：前置审计返回需修订（NEEDS_REVISION）

实现前审计运行后，针对特定发现项给出了 `NEEDS_REVISION` 的裁定。

1. **记录审计结果**：写入 `result_kind: audit, verdict: NEEDS_REVISION`。
2. **确认发现项**：明确具体的漂移问题或违反的禁用模式。
3. **拒绝分派**：`NEEDS_REVISION` 是阻塞型裁定，Worker 无法拿到任务。
4. **管理者处理问题**：无论是修改 Packet 范围（比如新增禁止项、缩小边界）还是解决深层原因（比如先准入前置任务）。
5. **重新审计**：发起新的实现前审计；如果这次拿到 PASS，才可以进行分派。

审计结果直接驱动了下一次 Packet 修订，这里不存在“虽然审计说不行，但我们还是强行做吧”的选项。

## 场景案例：落地后判断捕捉到设计漂移

代码实现落地了，且之前已经拿到了实现前审计的 PASS，Worker 宣告任务“完成”。

1. **落地后判断**：独立评审循环介入，检查实际产出的工作。
2. **发现漂移**：审计发现 Worker 引入了一种计划外的 `dual_read` 模式，这是前置审计无法预见的。
3. **裁定结果**：`judgement: NEEDS_REVISION`。
4. **打回重做**：该 Wave 返回至修订状态，在拿到新的 PASS 之前，禁止进入下一阶段。
5. **执行者修正**：Worker 移除 `dual_read`，重新提交。
6. **再次评审通过**：拿到判断的 PASS，此时 Wave 才可以继续推进。

正是因为拥有完全独立的落地后判断关口，执行阶段才产生的隐性漂移才得以被拦截。

## 场景案例：规范更新的复审门 (A Spec Update Review Gate)

一个成功实现了规范（Spec）变更的 Packet 已经分别拿到了实现前审计和落地后判断的双重 PASS。通常情况下，这足以让系统顺畅地进行机械相变。

但此时有一条例外规则：**针对规范更新，即使判定都通过，在推进下一步之前仍需要经过人工确认（Human confirmation）的复审门。** 系统必须停留在 `require_human_confirmation` 状态，并附带原因码 `spec_update_review_required`，直到新的 judgement PASS 被记录下来。

设立这条规则的原因是，规范层面的变动极其重大。即使代码实现机械层面干净无瑕，也必须在此设置一道人工确认的闸门，防止它被立刻、自动地向下推演。

## 边界总结

| 关注点 | 拥有者 |
| --- | --- |
| 实现前审计 (Pre-implementation audit) | 独立审计员 (Independent auditor) |
| 审计结果登记 (Audit result recording) | 管理者 (Manager) |
| 分派决定 (Worker dispatch decision) | 管理者 (在审计 PASS 之后) |
| 落地后判断 (Post-implementation judgement) | 独立审计员 |
| 机械相变 (Mechanical phase transition) | 管理者 (在判断 PASS 且通过规范更新复审门之后) |

## 来源依据

- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/decision-review.schema.yaml)
