# 宿主无关边界

Nimi Coding 具备宿主无关性，因为项目真相与验收不依赖某一家 AI 厂商的任务表示。
每个已准入宿主保留自己的计划与 runtime 状态，同时消费同一套仓库权威、约束和门禁。

## 跨宿主稳定的表面

| 项目表面 | 含义 |
| --- | --- |
| `.nimi/spec/**` | Canonical 产品与架构真相 |
| `.nimi/methodology/**` | 变更分类与治理规则 |
| `.nimi/contracts/**` | 规范分类、放置、生成证据与校验结构 |
| 项目 scripts | 确定性验证 |
| `.nimi/local/**` | 非语义本地证据 |

## 宿主持有的能力

每个宿主持有任务创建、规划、子代理、上下文管理、重试、恢复、复核与完成。
Nimi Coding 0.3.x 不再提供宿主 adapter registry 或 handoff runtime，只向宿主提供
仓库上下文和确定性命令。

## 准入宿主

适合的宿主必须能够：

- 按声明顺序读取所需仓库权威；
- 保留 fail-closed error 和 blocker；
- 区分权威、生成视图与证据，不混为一谈；
- 在需要时运行项目检查与真实 runtime/app 验收；
- 在准入 custody 内保存 secrets 与 provider credentials；
- 不把任务进度写入项目语义真相。

切换宿主时，在新宿主中重新开始任务并重跑所需门禁即可。无需迁移 Nimi Coding 的
执行状态或 adapter 配置。

## 来源依据

- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
