# 教程：第一个 Wave 端到端

这个教程带你走一个 wave 从准入到 closeout。结束时你会有：

- `.nimi/topics/ongoing/` 里一个小样本 topic
- 一个 wave 准入、冻结、dispatch、审计、闭合
- 演示四闭合框架的 closeout 工件

## 前置条件

| 要求 | 为什么 |
| --- | --- |
| 完成 [第一个 Topic Bootstrap](/zh/nimicoding/tutorials/first-topic) | `.nimi/**` 要在 |
| `.nimi/spec/**` 下规范化 spec 树 | `high_risk_execution` 技能要 |
| Admitted 外部 AI host | Worker 角色 |
| 第二个 admitted 外部 AI host（或 session） | Auditor 角色 |

Auditor host 必须跟 worker host 不同。`manager_worker_auditor` 模式下跟 worker 同 session **不**被准入。

## 样本任务

我们用一个虚构但真实的任务：**给一个公开文档参考页加一个新字段**。字段在 spec 准入；文档页是消费方。工作够小、能端到端走，但够真、能演练所有闸门。

这是教程的合成例子；除非你想把工件 commit 到项目，**别**真跑这些步骤。

## 步骤 1：写 topic

建 `.nimi/topics/proposal/2026-XX-XX-add-reference-field/topic.yaml` 带必填字段。状态：`proposal`。

Topic 的 `entry_justification` 命名要加的 spec 字段与要更新的文档页。

## 步骤 2：写 wave

加 wave 条目到 `topic.yaml`：

```yaml
waves:
  - wave_id: wave-1-add-reference-field
    slug: add-reference-field
    state: candidate
    primary_closure_goal: |
      在准入 spec 合同下给 docs/reference/some-page.md 加新字段
      FOO；保留 source basis。
    deps: []
    owner_domain: docs/reference/some-page.md
    parallelizable_after: stable_readability_contract
    selected: true
```

把 topic 搬到 `.nimi/topics/ongoing/...`，更新 `topic.yaml.state: ongoing` 与 `last_transition_reason: wave_admitted`。

## 步骤 3：冻结 packet

写 `packet-wave-1-add-reference-field.md`。Packet id 也带上 wave 身份，例如 `packet_id: wave-1-add-reference-field`，这样后续生命周期命令不会生成含混的 `packet-*.md` 工件。

Packet 必填：

- `packet_id`、`topic_id`、`wave_id`、`packet_kind`
- `authority_owner`
- `canonical_seams`
- `forbidden_shortcuts`
- `acceptance_invariants`
- `negative_tests`
- `reopen_conditions`
- 交给 worker 执行时写 `allowed_reads` 和 `allowed_writes`

`topic packet freeze` 校验草稿并写出冻结后的 packet 工件。冻结之后再 dispatch；`topic worker dispatch` 把它推到 `status: dispatched` 后，worker 才正式被这个 packet 约束。

## 步骤 4：跑 preflight

写 `preflight-result-wave-1-add-reference-field.md` 带裁定与必填字段。如 preflight PASS，dispatch。

这个 wave 是 `implementation` 类（**不是** `spec`/`authority`/`redesign`/`preflight`），所以权威收敛闸门**不**触发。**不**要实现前审计。

## 步骤 5：Hand off 给 worker host

跑：

```
nimicoding handoff --skill high_risk_execution --json
```

CLI 发权威 JSON payload。给你 worker host（你用来做工作的 AI session）。

## 步骤 6：Worker 干活

Worker host：

- 只读 `allowed_reads`。
- 只写 `allowed_writes`。
- 在 packet 边界停。
- 返类型化结果。

具体：worker 编辑 `docs/reference/some-page.md` 在准入合同下加新字段 FOO，更新 Source Basis 段。

## 步骤 7：Ingest worker 结果

跑：

```
nimicoding ingest-high-risk-execution --from worker-result.json
```

CLI 机器校验结果。如有效，ingest 工件被记下。

## 步骤 8：把审计 hand 给第二个 host

跑：

```
nimicoding handoff --skill high_risk_execution --json （或具体审计 handoff）
```

给你 **auditor host**（跟 worker 不同）。Auditor 对照四闭合 review 工作。

样本任务里，审计检查：

- 权威闭合：spec 字段 FOO 准入了？引了 source basis？
- 语义闭合：必填属性 documented？
- 消费方闭合：渲染文档页对读者有用？
- 抗漂移：禁用捷径未引入？

## 步骤 9：记审计结果

写 `audit-wave-1-add-reference-field.md` 记裁定与 finding。

教程样本任务，假设裁定 = PASS。

## 步骤 10：Manager 记 closeout

写 `closeout-wave-1-add-reference-field.md` 带四闭合维度：

```yaml
authority_closure: closed
semantic_closure: closed
consumer_closure: closed_pending_user_acceptance（或 closed）
drift_resistance_closure: closed
disposition: complete
```

教程样本任务，如果渲染输出仍要人审，consumer_closure 可能记为 `closed_pending_user_acceptance`。

## 步骤 11：闭 wave

更新 `topic.yaml`：wave-1 状态搬到 `closed`。

如果 topic 还有更多工作，准入 wave-2。否则把 topic 搬到 closeout（如果你想完整 topic 闭合，单独覆盖）。

## 步骤 12：校验

跑 `nimicoding doctor`。它该报新 wave 工件就位的健康状态。

## 你现在有什么

教程后你有：

- 一个 topic 带一个闭合 wave。
- 全部 7 种工件类型：`topic.yaml`、packet、preflight 结果、worker 结果、审计、manager judgement（如适用）、closeout。
- 四闭合框架在动作中的可演示证据。

## 你练了什么

| 技能 | 你做了什么 |
| --- | --- |
| Topic 准入 | 写 topic.yaml |
| Wave 准入 | 加 wave 条目 |
| Packet 冻结 | 冻结执行合同 |
| Preflight | 停止线检查 |
| Handoff | CLI handoff 给 host |
| Ingest | CLI ingest 结果 |
| 审计 | 不同 host 审计 |
| Closeout | 四维闭合 |

## 这个教程**没**覆盖什么

| 关注 | 在哪找 |
| --- | --- |
| 权威收敛闸门 | [权威收敛](/zh/nimicoding/authority-convergence)（wave 触 spec 时） |
| Overflow 续作 | [伪闭合分类](/zh/nimicoding/false-closure-typology) |
| Topic 级 closeout | （在 topic-workflow + topic-lifecycle 覆盖） |
| True close vs 文件夹 closed | [Topic 生命周期](/zh/nimicoding/topic-lifecycle) |

## 下一步

你现在知道完整周期。具体场景需要调整周期，见 [How-to 菜谱](/zh/nimicoding/how-to/)。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)（高风险执行命令）
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
