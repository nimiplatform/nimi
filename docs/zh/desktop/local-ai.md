# Nimi Home 中的本地 AI

打开「AI 能力」准备并选择本地能力配置。首页包含 Profile 推荐与分享，以及这台设备上的模型；能力工作区展示已保存配置、资源、准备状态和当前默认项。

## 在哪里操作

| 界面 | 任务 |
| --- | --- |
| AI 能力 | 配置能力，并明确选择机器默认项 |
| 模型库 | 查看、导入、校验、删除模型文件与管理存储 |
| 配置环境 | 查看某个已保存配置需要的环境 |
| 共享组件 | 通过所属操作查看机器共享组件 |
| 下载 | 跟踪已经创建的 App、模型与环境任务 |
| 云服务 | 独立管理云端连接 |

## 从模型到第一次请求

先安装或导入必要资源，把实现 recipe 及全部资源配置成 Loadout，再明确选为该能力的当前配置。随后在 App AI 设置中保存 Local 意图，执行一次真实请求。Agent Chat 的意图属于当前账号共用的 LocalAgent 配置。

选中的 Loadout 是该能力的机器默认项，因此修改会影响其他 owner 后续的 Local 提交。已有 Job 保留提交时的执行输入。

## 状态代表什么

文件校验表示字节符合登记身份；配置准备状态综合该配置的资源与环境检查；默认标签表示当前选择。这些标签都不能证明请求已经执行成功。

同一模型的多个变体或配置分别展示。没有匹配 recipe 时显示用途未识别，配套资源不能标为独立完成能力的模型。未检查的环境保持未检查。

Runtime 提供兼容性、推荐、进度和失败。Home 不会在 Job 失败时排名或选择替代实现。依赖通过 Runtime 已准入的安装流程处理并展示真实进度和失败，renderer 不执行任意 shell 命令。

配置与执行的精确关系见 [本地模型与 Loadout](/zh/runtime/local-models)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
