# 对齐分歧的审计结论

同一个 wave（或同一份 packet 决策）跑过两次审计，得到了不同结论。该如何对齐？

## 步骤

1. **确认两次审计都是真的。** 每次审计都应来自一个已准入的独立审计回路，并按强类型契约记录。
2. **看 finding，不只是看结论。** PASS 的审计也可能带告警；NEEDS_REVISION 的审计会指出具体阻塞项。
3. **默认更严的结论胜出。** 一个说 NEEDS_REVISION、一个说 PASS，那么 NEEDS_REVISION 那一份的 finding 是当下生效的门。PASS 不能软化阻塞项。
4. **由 finding 决定如何处置。** 处理具体阻塞项，不要为了拿 PASS 而反复重审。
5. **写一份明确的对齐工件。** 命名 `audit-reconciliation-<topic-or-wave-id>.md`，记录两次审计、finding 列表与最终选择的处置方式。
6. **如果对齐不是改代码而是修正审计**（比如 PASS 是对的，NEEDS_REVISION 来自误读），把推理过程与审计纠错路径记下来。
7. **必要时再审一次。** 处置完成后，跑独立的复审，记录新结论。

## 为什么默认更严胜出

四闭合要求所有四个维度都明确。NEEDS_REVISION 的 finding 标识了一处具体缺口。一份 PASS 审计如果没回应这处缺口，那它对此是沉默的，不是反驳。

方法学的结构性规则：**未解决的阻塞 finding 必须 fail-closed**。PASS 不能仅凭"我不同意"就推翻一处阻塞 finding。这处 finding 必须被处理（解决、声明非阻塞，或以强类型证据证伪）。

## 场景：一次真实的对齐

上一个公开文档修复 topic 的 wave-1 由两个独立会话审计：

- 审计 A：PASS
- 审计 B：NEEDS_REVISION（指出了 design-only 措辞的问题）

对齐过程：

| 步骤 | 操作 |
| --- | --- |
| 两次审计为真 | 已确认 |
| 看 finding | 审计 B 的阻塞项是 topic 级文件中的边界措辞 |
| 更严胜出 | 审计 B 的 NEEDS_REVISION 生效 |
| 处置 | 改边界措辞；preflight 重新划定范围以准入后续 wave |
| 对齐工件 | `external-audit-round-N-reconciliation.md` |
| 复审 | 由后续 wave 的准入审计承担 |

审计 A 的 PASS 在"设计包完整性"层面被接受，但它并不能压过审计 B 关于边界措辞的阻塞项。最终处置正面回应了审计 B 的具体 finding。

## 场景：两个 PASS 但带不同告警

审计 A：PASS，附非阻塞备注"建议补一个示例"
审计 B：PASS，附非阻塞备注"建议收紧 forbidden-shortcuts 列表"

这不是结论分歧，而是结论一致下的两条非阻塞备注。

处置：

1. 两个 PASS 结论都准入。
2. 非阻塞备注作为后续可改进项记录在案。
3. 不需要对齐工件（结论一致）。
4. 后续 wave 可以把非阻塞备注纳入范围。

## 场景：争议结论

审计 A：PASS
审计 B：FAIL，finding 是"该工作引入了 `silent_owner_cut_reopen`"

对齐过程：

| 步骤 | 操作 |
| --- | --- |
| 验证审计 B 的 finding | 检查实际工作；确认 owner cut 是否真被重新打开 |
| 如果 finding 成立 | 审计 B 的 FAIL 生效；该 wave 的 owner-cut 重开必须解决，或显式准入 |
| 如果 finding 不成立 | 审计 B 的证据被纠正；对齐工件解释原因；审计 A 的 PASS 维持 |

无论走哪条路，处置都要**强类型记录**，不能"看哪个结论顺眼选哪个"。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 两次审计来自同一回路 | 两次都拒绝；审计员必须独立 |
| 因为更快就选了更宽松的审计 | 软通过；拒绝 |
| 跳过对齐 | 违规；要求补对齐工件 |
| 反复重审直到 PASS | 软通过；finding 仍需处置 |

## 来源依据

- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
- [`nimi-coding/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/decision-review.schema.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/role-separation-policy.yaml)
