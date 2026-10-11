# 跨界面体验连续性（Cross-Surface Continuity）

用户在不同界面或显示窗口间切换时，与智能体的对话自然保持连贯。这种连续性源自 Realm 与 Runtime 统一维护的权威状态，而非各个前端界面私下同步 UI 状态。

Realm 提供持久化的 Character 资产与标准化 Character Source 描述；Runtime 负责在本地运行 LocalAgent，统一管控活跃对话、记忆检索路由、状态机与视觉呈现流。各个前端交互界面通过官方 SDK，根据当前安全会话的授权范围，订阅结构化的只读数据视图。

## 跨界面共享的数据与凭据

各个界面之间通过官方接口传递且仅能传递以下数据：
- 稳定的 Character 角色引用与 LocalAgent 运行态句柄（`agentHandle`）；
- 显式的 Runtime 会话锚点（Conversation Anchor）；
- 已提交确认的对话轮次视图与结构化状态；
- 已获授权的 Avatar 视觉动作指令与语音流。

接收方界面仅获得数据的引用与只读展示视图，绝不拥有底层数据的权威所有权。

## 保持在各交互界面本地的局部状态

窗口尺寸与布局、渲染器渲染上下文、媒体播放控制器进度、页面路由状态、输入框草稿以及短期的临时交互状态，均由具体的客户端或界面局部维护。前端本地缓存仅用于加速界面呈现，绝不能代替底层的状态恢复机制，也无法作为会话、记忆或授权数据的权威判定依据。

当授权发生变更或会话锚点失效时，客户端必须严格依照 Runtime 返回的结构化错误响应进行处理，严禁通过直接复制其他窗口的本地缓存来伪造会话连续性。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
