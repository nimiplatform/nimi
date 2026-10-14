# 本地优先与多设备协同

Nimi 既支持完全使用配置好的本地模型在用户设备上独立运行，也支持按需调用用户明确配置的云端大模型服务。「本地优先」（Local-First）并不等同于匿名或无限制的离线运行：Nimi 依然建立在账号体系之上，受保护的安全会话与授权策略在任何模式下均严格生效。

## 本地模型执行机制

在本地执行 AI 任务前，需要准备好运行环境与模型权重，配置并选用对应的本地推理后端（Local Loadout），并在应用或全局 LocalAgent AIConfig 中指定 `Local` 路由。在任务提交阶段，Runtime 会严格锁定当前所选的推理配置；若本地推理失败，系统不会隐式或自动回退到云端模型，以确保用户对隐私、数据流向和 API 成本拥有完全掌控。

Cognition 通过与 Runtime 的结构化桥接，在本地持久化管理各个智能体的私有长期记忆。长期记忆功能按智能体独立开启；Knowledge V1 目前没有活跃的数据写入或检索接口。实时会话流与本地审计日志分别由 Runtime 独立存储。

## 离线环境与网络边界

现有的本地工作流在所需的安全会话、能力令牌、本地模型资产及安全策略依然有效的前提下可顺畅进行。冷启动初始化、新账号登录、拉取最新 Realm 角色资产源、刷新授权凭据或发起云端模型推理，自然仍需网络连接。本地缓存仅用作性能优化，无法凭空伪造出已提交生效的 Realm 状态变更。

权威的世界历史、角色持久身份资产、社交图谱与经济状态由 Realm 统一掌管。本地未决的操作意图并不等同于已提交的 Realm 变更。在本地运行也不意味着系统会自动上传审计日志或自发进行跨设备记忆同步。

## 多设备运行与远期算力联邦

每一台设备均运行独立的本地 Runtime 守护进程，并维护各自特定的硬件 Loadout。即使通过同一个 Realm 账号在多台设备间共享角色身份，也不会自动同步本地硬件 Loadout、进行中的活跃会话流或智能体本地记忆。

点对点算力联邦（Compute Federation）属于前瞻性架构探索，并非现阶段的网络层协议或安装前置条件。应用程序绝不能通过直接连接远程机器的私有 Runtime 调试端口来模拟分布式能力；请始终使用官方支持的受保护宿主接口。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
