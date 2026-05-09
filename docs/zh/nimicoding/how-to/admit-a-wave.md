# 准入一个 Wave

你手上有一个处于 `ongoing` 状态的 topic，现在要在它下面准入一个新 wave。

## 步骤

1. **确认 topic 当前状态。** `topic.yaml` 应显示 `state: ongoing`。如果是 `pending`，先转回 `ongoing`，或者准入一个修复型 wave 来证成重新激活的合理性。
2. **取一个权威 wave id。** 按 `wave-N-<slug>` 模式构造 `wave_id`，确保不与该 topic 下已有 wave 重名。
3. **把 wave 条目写入 `topic.yaml`。** 必填字段：
   - `wave_id`、`slug`、`state`（起始为 `candidate`）
   - `primary_closure_goal`（一段话）
   - `deps`（依赖的已关闭 wave 列表，可为空）
   - `owner_domain`（一个主权属域）
   - `parallelizable_after`（取自允许的取值集）
   - `selected: true`（如果它是当前活跃 wave）
4. **同一时刻只能有一个 selected wave。** 把上一个 selected 的 wave 改为 `selected: false`。
5. **写 packet 工件。** 用带 wave 标识的 packet id 与文件名，例如 `packet-wave-2-content-rewrite.md`。必填字段：`packet_id`、`topic_id`、`wave_id`、`packet_kind`、`status`、`authority_owner`、`canonical_seams`、`forbidden_shortcuts`、`acceptance_invariants`、`negative_tests`、`reopen_conditions`。如果该 packet 要绑定 worker，还需要 `allowed_reads` 和 `allowed_writes`，把执行边界写明确。
6. **跑 preflight。** 输出 `preflight-result-<wave_id>.md`，带裁决。
7. **如触发权威收敛门** （packet kind 属于 `authority`/`spec`/`redesign`/`preflight`，或引用 `.nimi/spec/`）：跑实施前审计，记录 `result_kind: audit, verdict: PASS`。
8. **更新 wave 状态。** 当 preflight（必要时再加审计）裁决为 PASS，把 `topic.yaml` 中该 wave 的 `state` 由 `candidate` 改为 `admitted`。
9. **更新 `topic.yaml.last_transition_reason`。** 例如 `wave-2-foo-admitted_after_pre_audit_pass`。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 两个 wave 同时是 `selected: true` | 拒绝；同一时刻只允许一个 selected |
| 没跑 preflight 就准入 wave | 拒绝；preflight 是停止线 |
| Wave 触及 `.nimi/spec/` 而无前置审计 | 拒绝；权威收敛门必须触发 |
| `deps` 引用了不存在的 wave id | 拒绝；依赖必须真实存在 |
| `owner_domain` 列了多个属域 | 拒绝；每个 packet 只允许一个主属域 |
| Packet id 缺少 wave 标识 | 拒绝；后续生成的 `packet-*.md` 名会产生歧义 |

## 场景

你在管理一个文档修复型 topic。Wave-1 已关闭，用户已确认，现在要准入 wave-2。

| 步骤 | 结果 |
| --- | --- |
| 确认 topic ongoing | 是 |
| Wave id 取 `wave-2-content-rewrite` | 已构造 |
| 写入 topic.yaml | `state: candidate, selected: true` |
| 把 wave-1 的 selected 置 false | 完成 |
| 写 packet | 必填字段齐 |
| Preflight PASS | 已记录 |
| 未触及 spec 不需要权威收敛 | OK |
| 状态切到 admitted | 完成 |
| 更新 last_transition_reason | "wave-2-content-rewrite_admitted_after_user_acceptance_of_wave_1" |

至此 wave-2 可以派发。

## 来源依据

- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
