# Runtime 客户端

标准的 Nimi App 使用单一的宿主绑定客户端 `NimiLocalAppClient`，通常由官方脚手架在初始化时通过 Kit 自动创建。业务代码应通过 `client.ai`、`client.aiConfig` 以及规范授权的功能接口与底层交互；App 无需手动指定当前用户账号、App 所有者身份、Runtime 监听端口或安全传输细节。

`@nimiplatform/sdk/runtime` 模块向桌面宿主进程及受信任的基础设施提供强类型 Runtime 底层接口。仅在应用中导入这些类型或直接构建直连客户端，并不会赋予任何受管 App 权限。普通的本机 loopback gRPC 连接会严格拒绝 App 作用域内的 AI 执行、AIConfig 配置与本地安全存储操作，切勿将其作为业务应用的旁路通道。

## 请求与执行结果

AI 生成请求仅需携带业务提示词内容与标准参数。持久化的 AIConfig 负责声明采用 Local 本地还是 Cloud 云端路由，Runtime 会在请求提交时直接绑定选中的本地 Loadout 或确切的云端模型配置。SDK 不会擅自寻找替代模型，也不会在客户端注入敏感鉴权凭据。

- **流式响应**：返回严格按序生成的强类型事件流与终态结果。
- **异步 Job 任务**：遵循清晰的状态轮询契约（提交 Submit、状态查询 Get、拉取完整产物结果及显式取消 Cancel）。当网络观察中断时，应使用原 Job ID 恢复查询，切勿盲目重复提交任务。详见[流式设计](/zh/runtime/streaming)。
- **LocalAgent 交互**：智能体操作基于会话级授权句柄。对话状态、任务执行、共享配置、记忆管理与实时音视频分别受各自的权限范围保护。长期记忆由 Cognition 统一归口管理并由 Runtime 中介访问；Knowledge V1 暂不对外提供公开客户端接口。

## 错误处理与容错机制

SDK 会忠实保留 Runtime 返回的强类型错误、原因码 (Reason Code) 与操作指引信息。当输入数据格式非法或调用方缺少必要授权时，系统将直接阻断执行。当接口不存在或特定组合暂不支持时，开发者应当优雅向用户展示错误提示，严禁试图穿透调用 Runtime 私有接口或绕过安全层直连第三方 Provider。

推荐阅读路径：从[第一次 AI 调用](/zh/sdk/first-ai-call)、[AI 配置](/zh/sdk/ai-config-surface)以及 [App 授权机制](/zh/platform/agents/participation-authority)开始。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
