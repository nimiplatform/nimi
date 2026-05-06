# 怎么调和分歧审计

两个审计跑在同一个 wave（或同一个 packet 决定）上、返不同裁定。怎么调和？

## 菜谱

1. **校验两个审计都真。** 检查每个审计是不是被 admitted 独立循环产出、按类型化合同记。
2. **读 finding，不只读裁定。** `PASS` 审计可能有 caveat；`NEEDS_REVISION` 审计可能命名具体阻塞。
3. **更严裁定默认赢。** 如果一个审计说 `NEEDS_REVISION` 另一个说 `PASS`，`NEEDS_REVISION` 裁定的 finding 是当前活跃闸门。`PASS` 审计**不能**软化阻塞。
4. **Finding 驱动解决。** 处理被命名的阻塞；**别**只是再审计指望 `PASS`。
5. **记一份显式调和工件。** 写 `audit-reconciliation-<topic-or-wave-id>.md` 捕捉两个审计、finding 列表、选定解决。
6. **如果调和不是代码 fix**（比如 `PASS` 审计是对的、`NEEDS_REVISION` 审计基于误读），记 rationale 与审计的修正路径。
7. **如要再审计。** 解决后，重跑独立审计；记新裁定。

## 为什么更严默认赢

四闭合框架要四个维度都显式。`NEEDS_REVISION` finding 标识具体 gap。**不**处理那个 gap 的 `PASS` 审计对它沉默、**不**矛盾。

方法学的结构规则：**未解决阻塞 finding fail-close**。`PASS` **不能**通过简单分歧覆盖阻塞 finding；finding 必须被处理（解决、声明非阻塞、或类型化证据展示无效）。

## 阅读场景：真实调和

之前公开文档 remediation topic 的 wave-1 被两个独立 session 审计：

- 审计 A：PASS
- 审计 B：NEEDS_REVISION（带具体 design-only-language finding）

调和：

| 步骤 | 动作 |
| --- | --- |
| 两审计都真 | 确认 |
| Finding 检查 | 审计 B 的阻塞是关于 topic 级文件里的边界措辞 |
| 更严赢 | 审计 B 的 NEEDS_REVISION 持 |
| 解决 | 更新边界措辞；preflight rescope 准入后续 wave |
| 调和工件 | `external-audit-round-N-reconciliation.md` |
| 再审计 | 隐含在后续 wave 准入审计里 |

审计 A 的 PASS 被认作设计包完整性的证据；它**没**覆盖审计 B 的边界措辞阻塞。解决处理了审计 B 的具体 finding。

## 阅读场景：两个 PASS 带不同 caveat

审计 A：PASS，带非阻塞备注「考虑加例子」
审计 B：PASS，带非阻塞备注「考虑收紧禁用捷径列表」

这些**不**是裁定分歧；是带不重叠非阻塞备注的收敛。

菜谱：

1. 两个 PASS 裁定都被准入。
2. 非阻塞备注作为未来改进候选记下来。
3. **不**要调和工件（裁定收敛）。
4. 未来 wave 可能拾起非阻塞备注作范围。

## 阅读场景：争议裁定

审计 A：PASS
审计 B：FAIL，带 finding「工作引入 `silent_owner_cut_reopen`」

调和：

| 步骤 | 动作 |
| --- | --- |
| 校验审计 B 的 finding | 检查工作；看 owner cut 是否被重开 |
| 如 finding 持 | 审计 B 的 FAIL 是活跃闸门；wave 的 owner-cut 重开必须被解决或显式准入 |
| 如 finding 不持 | 审计 B 的证据被纠正；调和工件记原因；审计 A 的 PASS 持 |

不管哪种，解决都**类型化、被记下**，**不是**「我们挑了喜欢的裁定」。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| 两审计同循环 | 两个都拒；auditor 必须独立 |
| 因更快就挑松审计 | 软通过；拒 |
| 跳过调和 | 方法学规则违反；要求调和工件 |
| 再审计直到 PASS | 软通过；finding 仍要处理 |

## 来源

- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/decision-review.schema.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
