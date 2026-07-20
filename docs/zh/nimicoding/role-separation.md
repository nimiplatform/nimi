# 角色分离

角色分离避免高风险变更的产出回路成为唯一判断回路。当前 AI 宿主持有角色分配与
协调方式；Nimi Coding 定义职责和证据边界。

## 职责

| 角色 | 持有 | 禁止行为 |
| --- | --- | --- |
| 宿主执行者 | 计划、实现、测试、runtime 验证 | 编造权威或隐藏失败检查 |
| 权威 owner | Canonical 产品与架构决策 | 把局部执行状态当成产品真相 |
| 独立评审者 | 挑战权威对齐、证据、失败与漂移 | 一边修改实现，一边声称独立复核 |
| 人类决策 owner | 需要明确验收时的产品判断 | 把缺失证据包装成批准 |

一个人或一个 Codex 任务可以协调这些职责，但证据要能说明产出和独立判断何时来自
不同 pass。Codex 可以使用 review subagent、独立任务或另一家已准入宿主；Nimi
Coding 不派发或调度这些 pass。

## 评审输出

独立评审先报告 findings，引用检查过的权威和证据，再给明确 disposition。它不能
通过直接改代码让自己的 findings 消失。

如果评审发现 blocker，Codex 任务保持开放。执行者修复问题、重新运行受影响检查，
并在需要时取得新的独立复核。

## 来源依据

- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
