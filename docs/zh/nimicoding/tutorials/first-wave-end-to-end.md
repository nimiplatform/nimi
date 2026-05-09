# 教程：首个 Wave 端到端

本教程带你跑一个 wave，从准入一直走到 closeout。完成后你会拥有：

- `.nimi/topics/ongoing/` 下一个小样例 topic
- 一个准入、冻结、派发、审计、关闭都跑过的 wave
- 一组体现四闭合框架的 closeout 工件

## 前置要求

| 要求 | 原因 |
| --- | --- |
| 已完成 [首个 Topic 引导](/zh/nimicoding/tutorials/first-topic) | 需要 `.nimi/**` 已就位 |
| `.nimi/spec/**` 下的权威规范树 | `high_risk_execution` 技能要求 |
| 一个已准入的外部 AI 宿主 | 担任 worker |
| 第二个已准入的外部 AI 宿主（或会话） | 担任审计员 |

审计员宿主必须不同于 worker 宿主。在 `manager_worker_auditor` 模式下，与 worker 同一会话**不被准入**。

## 样例任务

我们用一个虚构但贴近现实的任务：**在一个公开文档参考页里加一个新字段**。该字段已在规范中准入，文档页是消费方。这个任务足够小，可以端到端走一遍，又足够真实，能触发所有的关卡。

这是教程用的合成示例。如果你不打算把这些工件提交到项目，请不要真的执行。

## Step 1：写 topic

创建 `.nimi/topics/proposal/2026-XX-XX-add-reference-field/topic.yaml`，填好必备字段，状态 `proposal`。

`entry_justification` 写明要新增的规范字段名以及要更新的文档页路径。

## Step 2：写一个 wave

把 wave 条目加到 `topic.yaml`：

```yaml
waves:
  - wave_id: wave-1-add-reference-field
    slug: add-reference-field
    state: candidate
    primary_closure_goal: |
      Add new field FOO to docs/reference/some-page.md
      under admitted spec contract; preserve source basis.
    deps: []
    owner_domain: docs/reference/some-page.md
    parallelizable_after: stable_readability_contract
    selected: true
```

把 topic 移动到 `.nimi/topics/ongoing/...`，并更新 `topic.yaml.state: ongoing`、`last_transition_reason: wave_admitted`。

## Step 3：冻结 packet

写 `packet-wave-1-add-reference-field.md`。Packet id 带 wave 标识，例如 `packet_id: wave-1-add-reference-field`，这样后续生命周期命令不会生成有歧义的 `packet-*.md` 工件。

Packet 必填字段：

- `packet_id`、`topic_id`、`wave_id`、`packet_kind`
- `authority_owner`
- `canonical_seams`
- `forbidden_shortcuts`
- `acceptance_invariants`
- `negative_tests`
- `reopen_conditions`
- 当 packet 要绑定 worker 时，还需要 `allowed_reads` 和 `allowed_writes`

`topic packet freeze` 校验草稿并写入冻结后的 packet。冻结后才能派发；一旦 `topic worker dispatch` 把 packet 切到 `status: dispatched`，worker 就受它约束。

## Step 4：跑 preflight

写 `preflight-result-wave-1-add-reference-field.md`，带裁决与必备字段。Preflight PASS 即可派发。

这个 wave 是 `implementation` 类（不属于 `spec`/`authority`/`redesign`/`preflight`），不会触发权威收敛门，不需要实施前审计。

## Step 5：交接给 worker 宿主

执行：

```
nimicoding handoff --skill high_risk_execution --json
```

CLI 输出一份权威 JSON payload。把它交给你的 worker 宿主（用来跑实际工作的 AI 会话）。

## Step 6：Worker 干活

Worker 宿主：

- 只读 `allowed_reads` 中的内容。
- 只写 `allowed_writes` 中的路径。
- 在 packet 边界处停下。
- 返回强类型结果。

具体到本教程：worker 编辑 `docs/reference/some-page.md`，按已准入契约加上字段 FOO，并更新 Source Basis。

## Step 7：摄入 worker 结果

执行：

```
nimicoding ingest-high-risk-execution --from worker-result.json
```

CLI 机械校验结果。校验通过则记录摄入工件。

## Step 8：把审计交给第二个宿主

执行：

```
nimicoding handoff --skill high_risk_execution --json （或专门的审计交接）
```

把 payload 交给**审计员宿主**（与 worker 不是同一个）。审计员对照四闭环复核工作。

样例任务的审计点：

- 权威闭合：规范字段 FOO 是否已准入？是否引用了 source basis？
- 语义闭合：必要属性是否已记录？
- 消费闭合：渲染后的文档页对读者是否有用？
- 漂移阻力：是否引入了禁止捷径？

## Step 9：记录审计结果

写 `audit-wave-1-add-reference-field.md`，记录裁决与 finding。

教程样例任务，假定裁决 = PASS。

## Step 10：管理者记录 closeout

写 `closeout-wave-1-add-reference-field.md`，覆盖四闭环维度：

```yaml
authority_closure: closed
semantic_closure: closed
consumer_closure: closed_pending_user_acceptance (or closed)
drift_resistance_closure: closed
disposition: complete
```

如果渲染结果还需要人工复核，consumer_closure 可以记为 `closed_pending_user_acceptance`。

## Step 11：关闭 wave

更新 `topic.yaml`：wave-1 状态切到 `closed`。

如果 topic 还有后续工作，准入 wave-2。否则进入 topic 收尾（如需走完 topic 闭合，单独有一节覆盖）。

## Step 12：复核

跑 `nimicoding doctor`。它应当报告健康状态，并能识别新增的 wave 工件。

## 现在你拥有什么

教程结束后，你拥有：

- 一个含一个已关闭 wave 的 topic。
- 七种工件齐全：`topic.yaml`、packet、preflight 结果、worker 结果、审计、（如适用）管理者裁定、closeout。
- 四闭环框架运行的可见证据。

## 你练过什么

| 技能 | 你做了什么 |
| --- | --- |
| Topic 准入 | 写 topic.yaml |
| Wave 准入 | 加 wave 条目 |
| Packet 冻结 | 冻结执行契约 |
| Preflight | 走完停止线检查 |
| Handoff | 用 CLI 交接给宿主 |
| Ingest | 用 CLI 摄入结果 |
| 审计 | 由不同宿主审计 |
| Closeout | 完成四维闭合 |

## 本教程未涉及的

| 议题 | 去哪查 |
| --- | --- |
| 权威收敛门 | [Authority Convergence](/zh/nimicoding/authority-convergence)（wave 触及规范时） |
| Overflow 续接 | [伪关闭谱系](/zh/nimicoding/false-closure-typology) |
| Topic 级 closeout | （见 topic-workflow + topic-lifecycle） |
| True close 与文件夹关闭的区别 | [Topic 生命周期](/zh/nimicoding/topic-lifecycle) |

## 下一步

完整周期你已经走过一遍。后续不同情境下的具体调整，参考 [How-to 条目](/zh/nimicoding/how-to/)。

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)（高风险执行命令）
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
