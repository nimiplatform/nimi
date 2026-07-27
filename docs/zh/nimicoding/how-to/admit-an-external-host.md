# 准入外部宿主

外部宿主需要能够读取 Nimi 的权威并执行门禁，同时不取得产品权威、不弱化
fail-closed 行为。Nimi Coding 0.3.x 不维护 adapter registry，也不提供宿主 runtime。

## 做法

1. 读取仓库 `AGENTS.md` 与受影响的 `.nimi/spec/**` 权威。
2. 验证仓库读写范围和命令执行能力。
3. 制造一次 blocked 结果，确认宿主会保留 blocker。
4. 运行确定性项目检查并记录真实结果。
5. 涉及 app 时，确认宿主能驱动真实 app/runtime 验收路径。
6. 复核 secret、token 与 provider custody。
7. 确认计划、进度、复核与完成状态只存在于宿主，不写入仓库语义层。

## 必备边界

| 宿主持有 | 宿主不持有 |
| --- | --- |
| 任务、计划、子代理、重试、恢复、完成 | `.nimi/spec/**` 权威 |
| Context 与执行机制 | Nimi Coding 方法论或契约 |
| 真实命令与 runtime 交互 | 把本地证据提升为产品真相的权力 |

## 拒绝条件

宿主制造证据、把 blocked 结果改成成功、绕过 canonical SDK/runtime 表面、要求
secret 离开准入 custody，或把任务进度写入项目语义真相时，必须拒绝准入。

## 来源依据

- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
