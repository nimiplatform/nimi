# App 中的 Realm 访问

用户账号、角色设定 (Character)、虚拟世界 (World)、社交图谱、经济体系、历史事实与公共资产的权威数据统一由 Realm 归口管理。Nimi App 通过宿主绑定客户端导出的 `client.realm` 标准操作与其交互。底层 Runtime 充当安全中介，负责安全代理经授权的 Realm 访问，而无需将敏感的 Realm Token 或原始 REST/WebSocket 传输信道直接暴露给应用层。

## 强类型专属操作

应用仅能调用当前 App 清单已声明且具备权限的规范接口，用户账号与 App 主体身份均由宿主注入的受保护会话自动推导。角色所有者操作、世界状态接口以及 Realm 实时通信通道分别拥有强类型的输入参数、鉴权逻辑与返回值契约，平台不提供任何无边界的泛化旁路代理。

独立的 `@nimiplatform/sdk/realm` 门面接口仅面向自行维护 Realm 鉴权会话的外部后台脚本，标准 Nimi App 严禁使用它试图逃逸宿主的安全会话边界。早期废弃的 `@nimiplatform/sdk/world` 子路径已彻底移除。

## 标准业务集成流程

1. **读取权威信息**：通过宿主客户端的 Realm 方法读取必要的世界信息或角色属性。
2. **结合 AI 与智能体**：常规应用 AI 任务使用 `client.ai`；涉及智能体自主协作的任务则使用对应授权的 Agent 接口。
3. **沉淀应用自有逻辑**：具体的页面交互编排、本地草稿保存与展示逻辑完整保留在 App 内部。
4. **提交权威变更**：当用户确认修改 Realm 数据时，调用对应的专属写入方法，并基于服务端返回的真实结果更新界面。

本地客户端的缓存快照或界面的临时乐观更新均不能作为 Realm 的权威状态。当安全会话失效或操作被拦截时，接口将明确抛出强类型错误，开发者不应试图通过手写原始 `/api/...` 请求发起旁路探测。

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
