# 权威收敛

权威收敛是规范、权威与 redesign 工作的 fail-closed 规则。实现改变 canonical
truth 之前，当前 Codex 任务必须确认 owner、检查冲突，并取得所需的独立判断。

## Preflight

| 字段 | 必须回答的问题 |
| --- | --- |
| `Spec Status` | 当前权威是否存在、足够明确且内部一致？ |
| `Authority Owner` | 哪个 canonical 表面决定这项变更？ |
| `Work Type` | 这是 alignment，还是已经准入的 redesign？ |
| `Parallel Truth` | 方案是否会制造另一个 owner？ |

任何未解决的 blocker 都会停止实现。

## 收敛顺序

1. Codex 读取当前权威与受影响 consumer。
2. 独立复核指出矛盾、缺失 owner 和下游影响。
3. 权威 owner 在 `.nimi/spec/**` 解决已准入决策。
4. Codex 根据收敛后的真相实现。
5. Validators 与真实 consumer 检查证明对齐。
6. 验收复核证据和 disposition。

这是语义顺序，不是执行调度器。Codex 自行决定如何规划和协调每一步。

## 停止条件

- 不存在 canonical owner；
- 两个 active source 声称持有同一真相；
- redesign 没有预先获得权威决策；
- 下游应用被用来重新定义上游契约；
- 必备独立复核或证据缺失。

正确结果是明确 blocking 或 partial disposition，而不是看似合理的 fallback。

## 来源依据

- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
