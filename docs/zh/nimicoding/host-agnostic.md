# 宿主无关边界

Nimi Coding 具备宿主无关性，因为项目真相与验收不依赖某一家 AI 厂商的任务表示。
每个已准入宿主保留自己的计划与 runtime 状态，同时消费同一套仓库权威、约束和门禁。

## 跨宿主稳定的表面

| 项目表面 | 含义 |
| --- | --- |
| `.nimi/spec/**` | Canonical 产品与架构真相 |
| `.nimi/methodology/**` | 变更分类与治理规则 |
| `.nimi/contracts/**` | Handoff、证据与验收形态 |
| 项目 scripts | 确定性验证 |
| `.nimi/local/**` | 非语义本地证据 |

## 宿主持有的能力

每个宿主持有任务创建、规划、子代理、context 管理、重试、恢复与完成。Adapter
只转换 handoff 输入和强类型输出，不把执行所有权转移给 Nimi Coding。

## 准入宿主

适合的宿主必须能够：

- 按声明顺序读取所需仓库权威；
- 保留 fail-closed error 和 blocker；
- 返回符合契约的结果，不制造证据；
- 在需要时运行项目检查与真实 runtime/app 验收；
- 在准入 custody 内保存 secrets 与 provider credentials；
- 不把任务进度写入项目语义真相。

切换宿主时，只需验证 adapter，并在新宿主中启动任务。仓库里没有需要搬运的执行状态。

## 来源依据

- [`.nimi/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/external-host-compatibility.yaml)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
