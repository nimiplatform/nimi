# 怎么准入一个 wave

你有一个 `ongoing` 状态的 topic。你想在它下准入一个新 wave。

## 菜谱

1. **确认 topic 状态。** `topic.yaml` 显示 `state: ongoing`。如果是 `pending`，先搬到 `ongoing`（或准入一个论证再激活的 remediation wave）。
2. **权威 wave id。** 按 `wave-N-<slug>` 模式组 `wave_id`；确保跟 topic 里既有 wave 不冲突。
3. **加 wave 条目到 `topic.yaml`。** 必填字段：
   - `wave_id`、`slug`、`state`（从 `candidate` 开始）
   - `primary_closure_goal`（一段）
   - `deps`（这个依赖的之前闭合 wave 列表；可空）
   - `owner_domain`（一个主 owner 域）
   - `parallelizable_after`（准入值之一）
   - `selected: true`（如这是当前活跃 wave）
4. **至多一个 selected wave。** 把之前 selected wave 的 `selected: false`。
5. **写 packet 工件。** Packet id 和文件名都带上 wave 身份，例如 `packet-wave-2-content-rewrite.md`。必填字段是 `packet_id`、`topic_id`、`wave_id`、`packet_kind`、`status`、`authority_owner`、`canonical_seams`、`forbidden_shortcuts`、`acceptance_invariants`、`negative_tests`、`reopen_conditions`。如果这个 packet 会交给 worker 执行，还要写 `allowed_reads` 和 `allowed_writes`，让执行边界明确。
6. **跑 preflight。** `preflight-result-<wave_id>.md` 带裁定。
7. **如权威收敛闸门触发**（packet 类是 `authority`/`spec`/`redesign`/`preflight` 或引 `.nimi/spec/`）：跑实现前审计；记 `result_kind: audit, verdict: PASS`。
8. **更新 wave 状态。** Preflight（与审计如需要）PASS 后，`topic.yaml` 里 `state: candidate → admitted`。
9. **更新 `topic.yaml.last_transition_reason`。** 简洁原因比如 `wave-2-foo-admitted_after_pre_audit_pass`。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| 两个 wave 都 `selected: true` | 拒；同一时刻一个 selected |
| Wave 没 preflight 就准入 | 拒；preflight 是停止线 |
| Wave 触 `.nimi/spec/` 没 pre-audit | 拒；权威收敛闸门必须触发 |
| `deps` 引一个不存在的 wave id | 拒；deps 必须真 |
| `owner_domain` 说多个域 | 拒；每个 packet 一个主 owner |
| Packet id 没带 wave 身份 | 拒；生成出来的 `packet-*.md` 名字后续可能含混 |

## 阅读场景

你管一个文档 remediation topic。Wave-1 闭了；用户接受；wave-2 要准入。

| 步骤 | 输出 |
| --- | --- |
| 确认 topic ongoing | 是 |
| Wave id `wave-2-content-rewrite` | 组好 |
| 加到 topic.yaml | `state: candidate, selected: true` |
| Wave-1 selected: false | 完成 |
| 写 packet | 所有必填字段在 |
| Preflight PASS | 已记 |
| 不触 spec → 不要权威收敛 | OK |
| 状态搬到 admitted | 完成 |
| `last_transition_reason` 更新 | "wave-2-content-rewrite_admitted_after_user_acceptance_of_wave_1" |

Wave-2 现在准备 dispatch。

## 来源

- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
