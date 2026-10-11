# LocalAgent 运行时生命周期与执行架构

本地运行时（Runtime）负责 LocalAgent 的本地实例化、上下文维护与执行调度。LocalAgent 由 Realm 签发并认证的 Character 规范派生而来，并与确切的所有者（Owner）强绑定；它是智能体在本地执行环境中的受控实体。

## 执行职责边界

Runtime 集中管理以下核心逻辑：

- **实例生命周期与所有权隔离**：负责 LocalAgent 的本地初始化、内存分配、运行态上下文维护及跨租户隔离；
- **会话连续性（ConversationAnchor）**：维护会话锚点，保证多轮交互中的上下文连续性、断点恢复与生成中断处理；
- **长期记忆中介**：充当 Cognition 记忆系统的受保护中介，安全代理记忆的检索、召回与持久化；
- **能力意图解析与凭据托管**：解析应用声明的能力意图（Capability Intent），按已配置的 Local 或 Cloud 路由执行本地推理任务或云端调用，并在受保护环境中托管 API 密钥与认证凭据；
- **结构化输出校验**：在模型生成内容落地为会话记录、交互状态或语音流之前，执行统一的安全校验与格式归一化；
- **安全投影给上层应用**：向已获授权的调用方提供类型安全的结构化视图。

应用层通过 SDK 提交高阶意图，Runtime 基于当前活跃的会话自动推导调用方身份与权限范围。正规 App 应使用当前会话颁发的 `agentHandle` 与 Agent 交互，避免硬编码底层内部 ID。

## 消费端与前端架构边界

桌面端（Desktop）、主页（Nimi Home）与形象引擎（Avatar）作为呈现层，订阅并渲染已授权的会话、状态及多媒体投影：

- **表现层解耦**：前端界面无需解析供应商底层私有协议，也不维护执行状态机。
- **虚拟形象消费**：Avatar 读取获准消费的活动、情绪、语义姿态和有界语音时序，负责后端映射，以及由最终语音产物派生的本地播放与口型。渲染器口型帧不属于 Runtime 通用输入。

## 会话连续性与状态隔离

每个 LocalAgent 维持单一由 Runtime 托管的权威会话（Conversation）。即使从多个不同的前端窗口或应用中唤起，也会自动汇入并延续同一段对话历史。

由同一个 Character 模板派生出的不同 LocalAgent 之间保持严格独立的状态空间。关于会话锚点与授权机制的详细说明，请参阅[会话锚点（Conversation Anchor）](/zh/platform/agents/conversation-anchor)与[智能体参与权限](/zh/platform/agents/participation-authority)。

## Source Basis

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
