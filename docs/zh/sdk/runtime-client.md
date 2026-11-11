<!-- nimi-docs: {"authority":["rule.nimi.sdks.client-core.remote-runtime-carrier","rule.nimi.runtime.remote-access.operation-carrier"],"sources":["sdks/typescript/package.json","sdks/typescript/runtime/remote.ts","sdks/typescript/runtime/remote-app.ts","examples/sdk/08-remote-runtime.ts"]} -->

# Runtime 客户端

本页分别介绍本机原生与远程 App 的客户端。当前远程入口需要[源码制品组合](/zh/start/install)。

## 本机原生客户端

标准的 Nimi App 使用单一的宿主绑定客户端 `NimiLocalAppClient`，通常由官方脚手架在初始化时通过 Kit 自动创建。业务代码应通过 `client.ai`、`client.aiConfig` 以及规范授权的功能接口与底层交互；App 无需手动指定当前用户账号、App 所有者身份、Runtime 监听端口或安全传输细节。

`@nimiplatform/sdk/runtime` 模块向桌面宿主进程及受信任的基础设施提供强类型 Runtime 底层接口。仅在应用中导入这些类型或直接构建直连客户端，并不会赋予任何受管 App 权限。普通的本机 loopback gRPC 连接会严格拒绝 App 作用域内的 AI 执行、AIConfig 配置与本地安全存储操作，切勿将其作为业务应用的旁路通道。

## 请求与执行结果

AI 生成请求仅需携带业务提示词内容与标准参数。持久化的 AIConfig 负责声明采用 Local 本地还是 Cloud 云端路由，Runtime 会在请求提交时直接绑定选中的本地 Loadout 或确切的云端模型配置。SDK 不会擅自寻找替代模型，也不会在客户端注入敏感鉴权凭据。

- **流式响应**：返回严格按序生成的强类型事件分块 (chunks)，并以明确的终态结果结束。
- **异步 Job 任务**：遵循清晰的状态轮询契约（提交 Submit、状态查询 Get、拉取完整产物结果及显式取消 Cancel）。当网络观察中断时，应使用原 Job ID 恢复查询，切勿盲目重复提交任务。详见[流式设计](/zh/runtime/streaming)。
- **LocalAgent 交互**：智能体操作基于会话级授权句柄。对话状态、任务执行、共享配置、记忆管理与实时音视频分别受各自的权限范围保护。长期记忆由 Cognition 统一归口管理并由 Runtime 中介访问；Knowledge V1 暂不对外提供公开客户端接口。

## 错误处理与容错机制

SDK 会忠实保留 Runtime 返回的强类型错误码、结构化原因码 (Reason Code) 与诊断元数据。当输入数据格式非法或调用方缺少必要授权时，系统将遵循 fail-closed 原则阻断执行。当接口不存在或特定参数组合暂不支持时，应用应向用户提供清晰友好的错误提示，切勿试图调用 Runtime 私有接口或绕过安全层直连第三方 Provider。

推荐阅读路径：从[第一次 AI 调用](/zh/sdk/first-ai-call)、[AI 配置](/zh/sdk/ai-config-surface)以及 [App 授权机制](/zh/platform/agents/participation-authority)开始。

## 远程 Web 与 Android 客户端

官方登录通过 `@nimiplatform/sdk/realm/runtime-client` 完成，再由 `@nimiplatform/sdk/runtime/remote` 的 `connectRemoteRuntime` 连接当前账号绑定的主 Runtime。App 通常使用 [Kit 会话工厂](/zh/platform/kit/use-kit-in-app)组合这些步骤，无需自行保管通用账号凭据。

普通 App 连接后会获得 `RemoteRuntimeAppConnection`，可使用已实现的 AI、自身的 AIConfig、App 私有 JSON/资产、LocalAgent Conversation 与管理，以及动态和固定 Realm 资源操作。每次调用的实际权限均由 Runtime 验证。该客户端不包含原生文件定位、远程启动 PC App、未实现的双向实时流以及管理端操作。

以下类型检查示例接收正式登录得到的当前 session，并在一次调用后关闭自己的连接。长驻 UI 应复用当前连接 scope，身份或连接变化时结束旧 scope。

<<< ../../../examples/sdk/08-remote-runtime.ts

`official_manager` 是经单独审核并验证的来源角色，仅暴露已实现的管理操作，普通 App 不能通过参数声明该角色。来源暂停、账号失效或断线都会结束对应的访问；签出、断开客户端与停止主机是三个不同的动作。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`sdks/typescript/runtime/remote.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/remote.ts)
- [`sdks/typescript/realm/runtime-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/realm/runtime-client.ts)
- [`examples/sdk/08-remote-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/08-remote-runtime.ts)
