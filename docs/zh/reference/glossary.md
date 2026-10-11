# 统一术语表（Glossary）

本文档提供 Nimi 平台核心概念、系统边界与技术术语的标准定义与对照。

## 身份、智能体与认知

- **Character（角色模板）**：在 Realm 中持久化存储的角色核心定义，包含其基础身份、全局唯一标识与世界观设定。包含 PersonaCharacter（通用伴侣角色）与 WorldCharacter（世界剧情角色）两种形态。
- **Character Source（角色源描述）**：由 Realm 签发的标准化角色描述文件，供 Runtime 在本地初始化并运行智能体实例。
- **World Source（世界源描述）**：Realm 托管的特定世界上下文描述，为智能体在特定世界中提供环境与剧情知识。
- **LocalAgent（本地智能体实例）**：本地 Runtime 根据 Character Source 实例化出的执行态实体，与当前用户会话强绑定，负责本地推理、动作执行与私有上下文维护。
- **ConversationAnchor（会话锚点）**：由 Runtime 分配的会话唯一持久化句柄。每个 LocalAgent 维持单一由该锚点绑定的连续对话流，供授权应用接入并延续历史。
- **Memory（长期记忆）**：由 Cognition 模块管理的 Agent 私有认知记忆，通过 Runtime 安全中介提供语义检索与动态沉淀。
- **Knowledge（知识域）**：由 Cognition 拥有的领域，当前 V1 尚无活动的写入、查询或公开客户端路径。

## 平台各层与产品形态

- **SDK（软件开发工具包）**：应用开发者与 Runtime、Realm 交互的标准化类型安全入口，提供 `@nimiplatform/sdk` 核心库。
- **Kit（组件与功能预设库）**：跨端通用的共享 UI 组件库（如 `@nimiplatform/kit`），提供即开即用的标准交互组件（如聊天面板、设置抽屉、状态卡片）。
- **Nimi Home**：用户本地工作台与应用入口，提供桌面端视觉呈现、本地模型管理与监督应用托管环境。
- **Avatar（虚拟形象引擎）**：专注于虚拟人 2D（Live2D）与 3D（VRM）图形管线渲染的独立应用，消费 Runtime 呈现事件以驱动高保真动效与实时口型同步。
- **Runtime（本地运行时）**：本地轻量级后台执行引擎，负责本地开源大模型调度、硬件加速驱动、外部云端连接器管理及受保护执行通道。
- **Realm（世界权威服务）**：云端分布式状态与权威协调服务，统一治理全局用户身份、社交图谱、世界状态演变及创作者经济体系。

## 架构原则与操作术语

- **State Projection（状态投影）**：数据权威源向下游消费端输出的结构化只读视图，用于界面呈现，数据持久化仍由权威端管控。
- **Capability Intent（能力意图）**：应用层向平台声明所需服务或能力的结构化请求（例如文本生成、语音合成），由 Runtime 负责将意图解析为具体的模型路由与参数。
- **Typed Unavailable（类型化不可用状态）**：平台返回的显式结构化错误响应，指明某项可选能力当前不可用的具体原因（如缺少驱动或权限不足），便于客户端向用户展示可行动的解决步骤。
- **Commit Envelope（提交信封）**：修改世界状态的标准结构化数据包，包含目标实体、变更范围（Scope）、影响分类（Effect Class）及因果证据。
- **Single Source of Truth（单一可信源）**：在分布式系统中对特定数据状态拥有最终决定权与持久化责任的核心节点（如 Realm 负责世界与社交，Runtime 负责本地会话与模型执行）。

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
