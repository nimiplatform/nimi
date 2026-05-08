# OVERFLOW 之后续接

Wave 返回 `OVERFLOW`，不是 `PASS` 也不是 `FAIL`。Worker 在实施过程中触到了 packet 边界。你想继续推进。

## 步骤

1. **读 OVERFLOW 结果。** Worker 完成了什么？停在哪？当前是什么状态？
2. **判断是否允许续接。** 三个允许条件，三个阻断条件。
3. **若允许**，准入一个续接 packet 来扩边界，恢复工作。
4. **若不允许**，wave 退回修订；准入新 wave 或重新划范围。

## 续接是否允许

| 维度 | 允许 | 不允许 |
| --- | --- | --- |
| 方向 | 仍正确 | 方向已偏 |
| 范围 | 未跨入新的 owner 域 | 已跨入 |
| 当前状态 | 可接受，仅 packet 边界划得太窄 | 引入了影子真相，或动用了 fallback |

方法学的 `overflow-continuation-policy` 写得很直接：

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

## 允许续接时的步骤

1. **写续接 packet。** 用与原 packet 不同的 `packet_id`，并引用原 packet。
2. **Wave 状态切到 `continuation_packet_open`。** 这是"已准入 overflow 续接"对应的强类型状态。
3. **续接 packet 的 `allowed_writes` 扩展边界。** 同一 owner 域，必要时覆盖更广的路径。
4. **续接 packet 的 `acceptance_invariants` 收紧或扩展**，把缺口的收尾条件写进来。
5. **派发 worker。** Worker 从原先停下的位置继续。
6. **审计。** 对续接结果做独立审计。
7. **关闭。** 工作完成后关闭 wave。

## 不允许续接时的步骤

1. **记录 overflow 原因。** 具体说：是影子真相、fallback，还是新域。
2. **Wave 状态切到 `needs_revision`。** 不是 closed，也不是 continuation-admitted。
3. **如果问题在原域内可修**：用新 packet 替换原 packet，原 packet 标记 `superseded`。
4. **如果问题需要按 owner 域重新划范围**：准入一个新 wave，owner 域换成新的；当前 wave 切到 `superseded`，或带显式血缘地退役。

## 场景：可续接的 overflow

某个 wave 在做一项较大的重构。Worker 完成了 80% 才触到 packet 的 allowed_writes 边界。方向正确，范围留在声明的 owner 域内，没有引入影子真相。

| 步骤 | 操作 |
| --- | --- |
| 结果类型 | OVERFLOW |
| 方向正确 | 是 |
| 跨 owner 域 | 否 |
| 引入影子真相 | 否 |
| 用了 fallback | 否 |
| 续接是否允许 | 是 |
| 续接 packet 已写 | 扩展 allowed_writes |
| Wave 状态 | `implementation_active → continuation_packet_open` |
| Worker 续作 | 完成 |
| 审计 | PASS |
| 闭合 | 四闭环维度齐 |

## 场景：不可续接的 overflow

某个 wave 在做重构。Worker 触到边界后，引入了一条 fallback 路径"先让它跑通"，并返回 OVERFLOW。

| 步骤 | 操作 |
| --- | --- |
| 结果类型 | OVERFLOW |
| 检查实际工作 | 引入了 fallback 路径 |
| 续接是否允许？ | 否（用了 fallback = 阻断） |
| Wave 状态 | `needs_revision` |
| 处置 | 新 packet 替换原 packet；移除 fallback；范围收紧 |
| 原 packet | `superseded` |

如果接受这条 fallback，就构成 `placeholder_success`。方法学拒绝它，wave 退回修订。

## 场景：overflow 跨入了新的 owner 域

某个 wave 在改 `runtime/`。中途 worker 发现要让这次改动有意义，必须同时改 `realm/`。Worker 在 packet 边界停下，返回 OVERFLOW，并标识出跨域需求。

| 步骤 | 操作 |
| --- | --- |
| 结果类型 | OVERFLOW |
| 分析中是否跨 owner 域 | 是 |
| 续接是否允许？ | 否（新 owner 域 = 阻断） |
| 处置 | 准入新 wave，owner 域设为 `realm/`；当前 wave 切到 `needs_revision` 或 `superseded`；新 wave 的 deps 包含当前 wave |

方法学逼出跨域需求：让 `realm` 工作通过新 wave 正式准入，而不是放任 runtime worker 偷偷扩进 realm。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 阻断条件已存在却为了"省时间"准入续接 | 软；拒绝 |
| 续接 packet 在下一步又跨 owner 域 | 拒绝；准入新 wave |
| 把 OVERFLOW 强行归一到 PASS | 伪关闭；拒绝 |
| 把 OVERFLOW 强行归一到 FAIL | 丢失进度证据；拒绝 |

## Source Basis

- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
