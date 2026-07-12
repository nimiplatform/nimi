# 准入外部宿主

外部宿主只有在能够消费 Nimi 真相与契约，同时不取得项目权威、不弱化 fail-closed
行为时，才能获得准入。

## 做法

1. 在 `.nimi/config/host-adapter.yaml` 定义 adapter identity。
2. 验证必备 context 顺序与仓库读取能力。
3. 验证强类型 handoff 输入与结果输出。
4. 运行一次 blocked 结果，宿主必须保留 blocker。
5. 运行确定性项目检查并捕获实际结果。
6. 涉及 app 时，证明宿主能驱动真实 app/runtime 验收路径。
7. 复核 secret、token 与 provider custody。

## 必备边界

| 宿主持有 | 宿主不持有 |
| --- | --- |
| 任务、计划、子代理、重试、恢复、完成 | `.nimi/spec/**` 权威 |
| Context 与执行机制 | Nimi Coding 方法论或契约 |
| 真实命令与 runtime 交互 | 把本地证据提升为产品真相的权力 |

## 拒绝条件

Adapter 制造证据、把 blocked 结果改成成功、绕过 canonical SDK/runtime 表面、要求
secret 离开准入 custody，或把任务进度写入项目语义真相时，必须拒绝准入。

## 来源依据

- [`.nimi/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/external-host-compatibility.yaml)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
