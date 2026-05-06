# 怎么 overflow 后重开

某 wave 返 `OVERFLOW`，**不是** `PASS` 或 `FAIL`。Worker 在实现中途撞 packet 边界。你想继续。

## 菜谱

1. **读 OVERFLOW 结果。** Worker 完成了什么？哪里停？当前状态？
2. **评估续作可准入性。** 三个正面条件；三个阻塞。
3. **如可准入**，准入延伸边界的续作 packet；恢复工作。
4. **如不可准入**，wave 回修订；准入新 wave 或重切范围。

## 续作可准入性

| 条件 | 可准入 | 不可准入 |
| --- | --- | --- |
| 方向 | 仍对 | 方向变了 |
| 范围 | 没跨进新 owner 域 | 跨了 |
| 当前状态 | 可接受；packet 边界太薄 | 引了影子真相或需要回退 |

方法学的 `overflow-continuation-policy` 显式：

```yaml
allowed_when:
  - direction_is_still_correct
  - scope_has_not_crossed_into_a_new_owner_domain
  - current_state_is_acceptable_but_packet_boundary_was_too_thin
reject_when:
  - shadow_truth_was_introduced
  - fallback_or_alias_was_needed
  - packet_crossed_into_a_new_owner_domain
```

## 可准入续作的菜谱

1. **写续作 packet。** 新 `packet_id` 跟原 packet 不同；引原 packet。
2. **Wave 状态搬到 `continuation_packet_open`。** 这是「overflow 续作 admitted」的类型化状态。
3. **续作 packet 的 `allowed_writes`** 延伸 — 同 owner 域，按需要更宽路径覆盖。
4. **续作 packet 的 `acceptance_invariants`** 收紧或延伸捕捉缺的 finish。
5. **Dispatch worker。** Worker 从原停的地方恢复。
6. **审计。** 独立审计续作结果。
7. **Closeout。** 工作完成时闭 wave。

## 不可准入 overflow 的菜谱

1. **记录 overflow 原因。** 具体：影子真相 / 回退 / 新域。
2. **Wave 状态搬到 `needs_revision`。** **不**闭、**不**续作 admitted。
3. **如果问题在同域可恢复**：新 packet 替代原；原 packet 变 `superseded`。
4. **如果问题要 owner-域 重切范围**：新 wave 准入，带新 owner 域。当前 wave 搬到 `superseded` 或带显式 lineage 退役。

## 阅读场景：续作的 overflow

某 wave 实施实质 refactor。Worker 在撞 packet 的 allowed_writes 边界前完成 80%。方向对；范围留在声明 owner 域；没引影子真相。

| 步骤 | 动作 |
| --- | --- |
| Result kind | OVERFLOW |
| 方向对 | 是 |
| Owner 域跨过 | 否 |
| 影子真相引入 | 否 |
| 需要回退 | 否 |
| 续作可准入 | 是 |
| 续作 packet 写好 | 延伸 allowed_writes |
| Wave 状态 | `implementation_active → continuation_packet_open` |
| Worker 恢复 | 完成 |
| 审计 | PASS |
| Closeout | 四闭合维度满足 |

## 阅读场景：不能续作的 overflow

某 wave 实施 refactor。Worker 撞边界时引了一条回退路径「让它工作」并返 OVERFLOW。

| 步骤 | 动作 |
| --- | --- |
| Result kind | OVERFLOW |
| 检查工作 | 引了回退路径 |
| 续作可准入？ | 否（需要回退 = 阻塞） |
| Wave 状态 | `needs_revision` |
| 解决 | 新 packet 替代原；移除回退；工作切更紧 |
| 原 packet | `superseded` |

回退如被接受会是 `placeholder_success`。方法学拒；wave 回修订。

## 阅读场景：Overflow 跨进新 owner 域

某 wave 在 `runtime/` 实施改动。中途，worker 意识到要在 `realm/` 改才有意义。Worker 在 packet 边界停返 OVERFLOW，已识别跨域需要。

| 步骤 | 动作 |
| --- | --- |
| Result kind | OVERFLOW |
| 分析里跨过 owner 域 | 是 |
| 续作可准入？ | 否（新 owner 域 = 阻塞） |
| 解决 | 准入一个以 `realm/` 为 owner 域的新 wave；当前 wave 搬到 `needs_revision` 或 `superseded`；新 wave deps 含这个 |

方法学把跨域需要逼到明面：新 wave 正确准入 realm 工作，**不是**让 runtime worker 静默延伸进 realm。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| 阻塞在场也续作「省时间」 | 软；拒 |
| 续作在下个 packet 跨 owner 域 | 拒；准入新 wave |
| Overflow 正常化为 PASS | 伪闭合；拒 |
| Overflow 正常化为 FAIL | 进展证据丢失；拒 |

## 来源

- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
