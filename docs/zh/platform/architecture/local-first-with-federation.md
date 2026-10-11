# 本地优先与多设备协同

Nimi 既支持完全使用配置好的本地模型算力在用户设备上独立运行，也支持按需调用用户明确配置的云端大模型服务。「本地优先」（Local-First）并不等同于匿名或无限制的离线运行：Nimi 依然建立在账号体系之上，受保护的安全会话与授权策略在任何模式下均严格生效。

## 本地模型执行机制

在本地执行 AI 任务前，需要完成环境就绪与模型文件准备，配置并选用对应的本地推理后端（Local Loadout），并在应用或全局 LocalAgent AIConfig 中指定 `Local` 路由。在任务提交阶段，Runtime 会严格固化当前所选的推理配置；当本地推理因资源不足失败时，系统不会隐式、静默地自动回退到云端模型，以保证用户对隐私与资费的绝对掌控。

Cognition 通过与 Runtime 的结构化桥接，在本地持久化管理各个智能体的私有长期记忆。长期记忆功能按智能体独立开启；Knowledge V1 暂无活动的数据导入或检索接口。实时会话流与本地审计日志分别由 Runtime 独立存储。

## 离线环境与网络边界

用户现有的本地工作与交互，在本地安全会话、授权令牌、模型权重资源及安全策略依然有效的前提下可顺畅进行。冷启动初始化、新账号登录、拉取最新 Realm 角色资产源、刷新授权凭据或发起云端模型推理，仍需网络连接。本地缓存仅作为性能加速手段，绝不能绕过网络凭证伪造出账号级或 Realm 级操作的成功结果。

数字世界客观事实、角色持久身份、社交图谱与经济系统的权威数据由 Realm 统一掌管。在本地尚未提交的操作意图，不代表 Realm 已经完成数据写入。本地运行并不意味着会自动进行跨设备记忆同步或未经授权的日志上传。

## 多设备运行与远期算力联邦

每一台设备均拥有独立的本地 Runtime 实例与设备级配置。即使通过同一个 Realm 账号在多台设备间共享角色身份，也不会自动同步本地硬件 Loadout、进行中的活跃会话流或智能体本地记忆。

点对点算力联邦（Compute Federation）属于远期技术探索方向，并非当前版本的底层传输协议或必备安装配置。严禁通过将应用直接指向另一台设备的私有 Runtime 调试端口来模拟分布式能力；开发者应始终使用当前产品正式支持的受保护宿主接口。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
