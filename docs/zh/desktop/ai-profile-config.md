# Nimi Home 中的 AI 配置与能力调度

在 Nimi Home 中，用户可以在「AI 能力」页面中统一准备本地模型配置，在「云服务」中连接第三方模型供应商，并在具体应用或专属智能体中灵活选择其底层的执行路由。

## 配置的归属与范围划分

为了保证安全隔离与个性化需求，Nimi 严格区分了不同维度的 AI 配置（AIConfig）：

- **应用独立配置（App-owned AIConfig）**：每个独立的 Nimi App 拥有其专属的 AIConfig。应用可以自由声明所需的能力（如文本生成、音频转写），并由用户针对该应用指定使用本地模型还是云端模型。
- **智能体通用配置（LocalAgent Shared AIConfig）**：当前账户下的所有 LocalAgent 共享一份基础能力配置。无论切换哪个智能体进行对话，底层都会复用该配置，避免重复设置。
- **会话与桌面聊天**：Nimi Chat 使用桌面端自身的 App 配置；而与特定 Agent 聊天时，则使用智能体的共享配置。

## 本地模型（Local）与云端服务（Cloud）的选择

针对每一项具体能力，用户均可选择执行路径：

1. **本地方案（Local）**：自动绑定当前机器在「AI 能力」中为该能力选定的默认运行方案（Loadout）。所有硬件资源与模型推理完全在本地执行，数据安全且离线可用。
2. **云端方案（Cloud）**：从已连接的第三方服务商（如 OpenAI、Anthropic 或兼容接口）中选择指定的目标接入点。出于安全考虑，API 密钥由本地 Runtime 安全存储，不会明文泄露至前端应用配置中。

## 导入与应用 AIProfile

用户可以导入或分享结构化的 AIProfile 配置文件以快速套用推荐配置。应用 AIProfile 时，系统会预填配置表单供用户审阅。用户在确认本地模型已就绪或云端 API Key 已配置后，点击保存即可正式生效。

关于本地模型的下载与部署，详见[本地 AI 配置](/zh/desktop/local-ai)；关于 Runtime 层的配置解析与调用细节，请参阅 [AI Profile 与执行机制](/zh/runtime/ai-profile-execution)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
