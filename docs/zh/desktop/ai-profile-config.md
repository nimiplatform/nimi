# Nimi Home 中的 AI 配置与能力调度

在 Nimi Home 中，你可以在「AI 能力」页面管理本地模型运行方案（Loadout），在「云服务」中接入第三方模型服务商，并为各 App 及共享的 LocalAgent 配置指定能力路由。

## 配置归属与作用域

为了兼顾安全隔离与个性化定制，Nimi 对不同维度的 AI 配置（AIConfig）划分了明确边界：

- **应用专属配置（App-owned AIConfig）**：每个独立的 Nimi App 各自维护隔离的 AIConfig。应用只需声明自身所需的能力（如文本生成、音频转写），由你决定每项能力走本地还是云端路由。
- **智能体共享配置（LocalAgent Shared AIConfig）**：当前账户下的所有 LocalAgent 共享同一套基础能力配置，免去为不同智能体重复配置基础模型的繁琐操作。
- **聊天上下文**：常规桌面聊天（Desktop Chat）使用桌面端自身的 App 配置；与特定 Agent 对话时，则统一使用 LocalAgent 共享配置。

## 选择本地运行（Local）或云端服务（Cloud）

针对应用或智能体声明的每一项能力，你都可以指定其执行路径：

1. **本地运行（Local）**：自动绑定当前设备在「AI 能力」中为该能力设定的默认运行方案（Loadout）。模型推理完全在本地硬件上完成，提示词与输出结果均保留在设备本地，该项推理能力可离线执行。
2. **云端服务（Cloud）**：通过已接入的第三方服务商（如 OpenAI、Anthropic 或兼容接口）发起调用。API Key 与接入点凭证由本地 Runtime 安全托管，不会以明文暴露在应用层配置中。

## 导入与应用 AIProfile

你可以导入可移植的 AIProfile 模板，快速套用推荐配置。导入后，系统会自动预填配置表单供你核对；确认本地模型就绪或云端 API Key 已关联后，点击保存即可生效。

关于本地模型权重的获取与管理，请参阅[本地 AI 配置](/zh/desktop/local-ai)；关于 Runtime 层的配置解析与执行细节，请参阅 [AI Profile 与执行机制](/zh/runtime/ai-profile-execution)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
