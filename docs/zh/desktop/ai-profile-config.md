# Nimi Home 中的 AI 配置

在「AI 能力」中准备本地配置，在「云服务」中管理云端连接，再进入对应 App 或共享 LocalAgent 的 AI 设置，决定各项能力的执行路径。

## 先确认配置归属

每个 App 有自己的 AIConfig。当前账号的全部 LocalAgent 共用一份 LocalAgent AIConfig；切换 Agent 不会创建新的 owner。Nimi Chat 使用 Desktop App 配置，Agent Chat 使用共享 LocalAgent 配置。

每项能力选择 Local 或 Cloud，并保存必要的功能要求和默认参数。Local 使用机器当前选中的该能力 Loadout；Cloud 必须从 Runtime 的安全选项中选择当前账号的确切 Connector 和实现目标。凭据与端点不进入 AIConfig。

保存时携带当前 revision，并整体替换能力列表；保留未修改项，省略表示清除。版本冲突需要重新审阅后保存。保存不要求先完成推理探测，也不代表执行已经可用。

## 准备本地能力

「AI 能力」包含 Profile 推荐与分享、设备上的模型列表，以及能力配置工作区。Loadout 绑定具体实现 recipe 和全部必要资源；通过设置流程准备并提交，再明确选为该能力的默认配置。

机器选择影响该能力今后的所有 Local 请求，不是某个 App 或 Agent 私有的模型绑定。已经提交的 Job 保留提交时固定的输入。

「模型库」负责文件查看、导入、存储、完整性和删除。「下载」展示已有 App、模型与环境任务。共享组件和配置环境展示各自的诊断，不产生另一套模型选择。

## 应用 Profile

应用可移植 AIProfile 只预填编辑器，不直接提交 owner 或机器状态。审阅内容，补齐当前环境的 Cloud 引用或本地资源，再完成对应的保存或确认。Profile 来源信息只用于说明，不形成持续绑定。

安装流程见 [本地 AI](/zh/desktop/local-ai)，提交行为见 [Profile 与执行](/zh/runtime/ai-profile-execution)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
