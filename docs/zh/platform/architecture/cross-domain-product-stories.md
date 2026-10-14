# 跨系统协作典型场景（Product Stories）

本篇通过具体业务场景，阐明不同系统边界在端到端用户流程中的协同方式。

## 场景一：创建角色并在本地运行智能体（Character to LocalAgent）

1. **选择角色**：用户在 Realm 提供的产品界面中创建或选择一个角色实体（Character）。
2. **生成源定义**：Realm 生成结构化的角色源描述（Character Source）。
3. **本地实例化**：Runtime 基于该源描述，在用户本地设备上实例化出属于当前账号的 LocalAgent。
4. **获取授权投影**：Nimi Home 或第三方独立 App 通过标准 SDK 仅获取经过授权的 LocalAgent 结构化投影。
5. **内部状态隔离**：Runtime 在自身安全边界内隔离管理会话历史、记忆检索通道、推理 Loadout、就绪状态及服务商密钥，不向下游暴露。

产品宿主不负责生成角色的持久身份定义，Realm 也无需介入本地 LocalAgent 的逐轮推理执行。

## 场景二：在不同交互界面间接续对话

1. **开启会话**：Runtime 建立会话上下文，并返回明确且唯一的会话锚点（Conversation Anchor）。
2. **多端状态渲染**：Desktop 客户端渲染已确认的对话轮次，并维护轻量的本地瞬时 UI 状态。
3. **具身形象绑定**：Avatar 渲染模块将虚拟角色的 2D/3D 形象绑定至同一个已授权的会话锚点。
4. **单一可信源保障**：Runtime 是会话连续性的唯一权威；两处交互界面均不得通过复制本地聊天记录来伪造恢复状态。

视线追踪与物理动作由 Avatar 在本地管理；对话文本、语音合成与呈现时序则由 Runtime 投影提供。

## 场景三：运行使用标准脚手架创建的独立应用（Scaffolded App）

1. **受保护拉起**：Nimi Home 通过本地受保护启动序列初始化第三方独立应用。
2. **提交类型化意图**：应用通过官方 SDK 提交结构化操作意图，并携带当前会话范围的 `agentHandle`。
3. **安全会话鉴权**：Runtime 直接从安全会话中推导当前账号、应用身份（App Identity）、授权范围与具体权限。
4. **最小权限返回**：应用仅收到经过类型校验的业务结果，全程无法接触 Realm JWT、底层模型 API 密钥、Runtime 内部凭据或账号下的全量智能体清单。

无论是直接嵌入 SDK 还是通过脚手架构建独立应用，均遵循统一的底层架构契约。应用与宿主的集成规范是系统底层的平台固化约束，而非由用户手动切换的配置项。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
