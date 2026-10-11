# 角色（Character）与智能体（LocalAgent）核心字段与映射规范

在 Nimi 的体系设计中，作为持久化数字资产的角色模板（Character）与在本地设备运行的智能体实例（LocalAgent）被严格解耦，各自归属于不同的权威域。

## 角色与智能体核心概念对照

| 概念/字段 | 归属权威域 | 业务含义与用途 |
| --- | --- | --- |
| **Character Reference** | Realm | 持久化数字角色的全局唯一标识与设定引用 |
| **PersonaCharacter / WorldCharacter** | Realm | 角色形态分类：独立虚拟伴侣（Persona）或世界专属角色（World） |
| **Character Source** | Realm | 签发的结构化角色规范数据包，供本地 Runtime 进行实例化 |
| **World Source** | Realm | 角色所处数字世界的上下文设定与环境背景 |
| **LocalAgent ID** | Runtime | 在本地运行环境中的智能体实例唯一标识 |
| **ConversationAnchor** | Runtime | 该智能体当前维持的唯一连续会话流句柄 |
| **长期记忆（Memory）** | Cognition | 该智能体的私有认知记忆库，由 Runtime 安全代理检索 |
| **AI 能力意图（Capability Intent）** | Runtime | 该角色对话推理所需调用的模型能力与参数路由 |
| **呈现设置（Presentation Config）** | Runtime | 智能体对外展示的持久化外观配置、默认声线与个性设定 |
| **交互呈现状态（Interaction State）** | Runtime | 单轮对话中的实时互动状态（如正在思考、倾听或说话中） |
| **渲染态（Renderer State）** | Avatar 应用 | 在图形引擎中由 GPU 实时计算的骨骼旋转、材质着色与表情动效 |

## 授权会话与访问规范

应用通过 SDK 与智能体交互时，遵循严格的会话凭证规范：
- **动态派生会话句柄（agentHandle）**：前端应用通过认证后的宿主环境获取短期会话句柄与智能体交互，无需在业务代码中硬编码底层实例 ID；
- **凭据最小化暴露**：底层的云端 API Key、用户私钥凭证均由 Runtime 安全隔离，绝不返回给前端应用渲染层。

## 连续性保障

每个 LocalAgent 维持单一由 `ConversationAnchor` 标识的连续会话流。授权应用无论是从主窗口、桌面小部件还是嵌入式侧栏唤起对话，都会自动接续该会话的历史上下文，确保智能体的记忆与对话连贯一致。

## 相关文档

- [会话锚点详解](/zh/platform/agents/conversation-anchor)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
