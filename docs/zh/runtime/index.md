# Runtime

Runtime 是 Nimi 的核心本地服务，负责将获得授权的产品意图转化为具体的 AI 执行。应用通过 SDK 提供的公开接口访问 Runtime，无需关心底层模型调度的复杂细节，敏感凭据与模型接入均由 Runtime 安全托管。

## Runtime 的核心职责

Runtime 负责管理与执行：

- **AI 执行与资源调度**：本地模型与云端 API 的调度、资源配额（Quota/Budget）以及连接器凭据的安全托管；
- **集中式 AI 风控**：在文本生成路径统一检查模型输入、输出和完整工具参数，详见[当前规则与拒绝处理方式](/zh/runtime/ai-risk-control)；
- **LocalAgent 实例管理**：基于 Realm 签发的角色描述（Character Source）在本地实例化 LocalAgent，并维护其生命周期；
- **交互与呈现投影**：维护 LocalAgent 的对话（Conversation）、记忆访问代理、状态机、语音与交互事件流；
- **本地服务与审计**：管理本地进程、模型加载、流式通信与本地审计日志；
- **权限与身份判定**：基于桌面端受保护会话推导应用身份与授权范围；
- **跨模块桥接**：提供与 Realm 服务及外部扩展能力的受控通信桥梁。

无论调用方是 Nimi Home、Desktop、Avatar 还是第三方 App，上述核心职责始终由 Runtime 统一管理。

## 架构权责边界

- **Realm**：维护持久化的角色身份（Character Identity）、世界背景（World Context）以及生态社交数据。Runtime 读取并使用这些上下文，但不修改或重新定义身份真相。
- **Cognition 与记忆边界**：长期记忆由 Cognition 专属性管理，按智能体独立隔离；Runtime 仅作为已授权的投递与召回中介通道。当前版本的 Knowledge V1 暂无活动读写或公共客户端路径。
- **应用层（Apps & UI Surfaces）**：负责自身的产品界面、用户交互与临时状态展示。应用不能越权接管对话路由、凭证管理或权限判定。
- **渐进式扩展**：外部工作流或扩展工具均作为可选能力接入，某项可选扩展不可用时不会阻塞核心的对话交互与基础 AI 调用。

## 阅读路径

- [集成](/zh/runtime/integrations)
- [流式传输](/zh/runtime/streaming)
- [集中式 AI 风控](/zh/runtime/ai-risk-control)
- [多模态执行](/zh/runtime/multimodal)
- [Agent 执行](/zh/runtime/agent-execution)
- [Memory 与 Knowledge](/zh/runtime/memory-and-knowledge)
- [Connector 与 Provider](/zh/runtime/connectors-and-providers)
- [本地 Model](/zh/runtime/local-models)
- [Account 与 Session](/zh/runtime/account-and-session)
- [委派能力](/zh/runtime/delegated-capability)
- [本地审计](/zh/runtime/audit-local)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
