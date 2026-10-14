# 统一术语表（Glossary）

本文档汇总了 Nimi 平台的核心概念、子系统职责与常用架构术语。

## 身份、智能体与认知

- **Character（角色模板）**：保存在 Realm 中的权威角色定义，包含持久身份、全局唯一标识与设定背景，分为 PersonaCharacter（通用伴侣角色）和 WorldCharacter（特定世界角色）两类。
- **Character Source（角色源描述）**：由 Realm 签发的标准化角色描述，供 Runtime 在本地实例化 LocalAgent。
- **World Source（世界源描述）**：由 Realm 托管的世界背景与环境规则描述，为特定世界中的智能体提供上下文。
- **LocalAgent（本地智能体实例）**：Runtime 在当前用户会话下创建的本地执行实体，负责推理、动作执行与短期上下文维护。
- **ConversationAnchor（会话锚点）**：由 Runtime 分配的持久化会话句柄。每个 LocalAgent 绑定唯一一条连续对话流，供受保护会话中的应用接入并延续对话。
- **Memory（长期记忆）**：由 Cognition 管理的单 Agent 私有长期记忆，统一经由 Runtime 检索与沉淀。
- **Knowledge（知识域）**：归属 Cognition 的领域，在当前 V1 中尚无活动的写入、查询或公开客户端路径。

## 平台各层与产品形态

- **SDK（软件开发工具包）**：连接应用与 Runtime、Realm 的类型安全客户端接口（`@nimiplatform/sdk`），仅暴露平台明确接纳的操作。
- **Kit（组件与预设库）**：跨端共享的 UI 组件与交互预设（`@nimiplatform/kit`），提供聊天流、设置面板等开箱即用的界面模块。
- **Nimi Home**：用户的产品主入口（当前由 Desktop 承载），提供本地模型管理、状态总览与受保护的应用宿主会话。
- **Avatar（虚拟形象引擎）**：专注于 2D（Live2D）与 3D（VRM）渲染管线的独立应用，接收 Runtime 的呈现事件流以驱动动作与实时口型同步。
- **Runtime（本地运行时）**：运行在本地后台的执行引擎，负责本地模型调度、硬件驱动管理、云端连接器托管、Cognition 记忆中介与受保护通道控制。
- **Realm（服务端协调层）**：负责全局身份、社交图谱、世界定义与状态契约，以及创作者经济规则的服务端系统。

## 架构原则与操作术语

- **State Projection（状态投影）**：由权威数据源向下游输出的只读结构化视图，仅用于界面渲染，数据持久化仍归原权威端负责。
- **Capability Intent（能力意图）**：应用声明所需能力（如文本生成、语音转写）的结构化请求，由 Runtime 解析为具体的模型与执行路由。
- **Typed Unavailable（类型化不可用状态）**：指明某项能力当前无法执行原因（如驱动未就绪、模型未配置或操作不在当前受保护会话接纳范围内）的结构化响应，便于界面给出明确引导。
- **Commit Envelope（提交信封）**：规划中用于描述共享世界状态变更的标准载荷契约，包含目标实体、变更范围（Scope）、影响类别（Effect Class）及来源证据。
- **Single Source of Truth（单一可信源）**：对特定领域的数据状态拥有唯一决定权与持久化职责的子系统（例如 Realm 与 Runtime 各自独立负责自身权威域）。

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
