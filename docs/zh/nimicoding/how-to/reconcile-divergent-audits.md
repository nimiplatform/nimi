# 对齐分歧的审计结论

两次独立复核对同一权威表面或结果给出不同结论。不能取平均，也不能选择更方便的
那个 verdict。

## 做法

1. 确认两次复核使用同一版 canonical authority，并检查同一份实现。
2. 把每项 finding 规范为 claim、evidence、affected owner 与 severity。
3. 用真实命令或 runtime 检查复现争议证据。
4. 让 canonical authority owner 解决语义分歧。
5. 记录哪项 finding 成立，以及理由。
6. 针对解决后的状态重新运行独立复核。

## 判断规则

| 情况 | 结果 |
| --- | --- |
| 一次复核使用过期权威 | 丢弃该 verdict 并重跑 |
| Findings 覆盖不同风险 | 两者都保留，满足全部必备检查 |
| 证据无法复现 | 结论保持 unresolved，不能算通过 |
| 产品判断不同 | 升级给已命名的人类 authority owner |
| Blocker 已确认 | Codex 任务保持开放，修复并复核 |

对齐记录只是本地证据，不能通过暗示改写 `.nimi/spec/**`。

## 来源依据

- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
