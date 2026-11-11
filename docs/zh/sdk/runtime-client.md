<!-- nimi-docs: {"authority":["rule.nimi.sdks.client-core.remote-runtime-carrier","rule.nimi.runtime.remote-access.operation-carrier","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union"],"sources":["sdks/typescript/package.json","sdks/typescript/runtime/remote.ts","sdks/typescript/runtime/remote-app.ts","examples/sdk/08-remote-runtime.ts","examples/sdk/09-media-jobs.ts","sdks/typescript/core/app/local-app-runtime-platform-ai.ts"]} -->

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

## 本地媒体任务示例

新的媒体配方需要配套的源码构建 SDK、Kit 和 Runtime。配置 App 前，先在 Home 准备模型。本次新增的能力 ID 只有 `image.upscale` 和 `video.upscale`；H3 Image、ControlNet 仍使用 `image.generate`，HyperFlow 和 Sol-H3-VAE 使用 `video.generate`。

下面的函数保存一项 Local 意图，保留 App 的其他能力配置，也不改变本机选中的模型。只有保存成功后才能继续提交；若出现版本冲突，应交由用户明确决定。

<<< ../../../examples/sdk/09-media-jobs.ts#configure

[多模态指南](/zh/runtime/multimodal)引用同一个经过类型检查的示例文件，展示上传、提交、保存结果和取消操作：

- 使用 `client.ai.artifacts.upload` 上传输入，传递返回的产物 ID，不传主机文件路径。
- 提交 `image-upscale` 或 `video-upscale`，字段为 `sourceArtifactId`、`scale: 2 | 4` 和可选 `seed`。
- ControlNet 使用 `image-generate` 的 `controlImage: { imageArtifactId, type, strength? }`；普通 H3 编辑则使用 `referenceImageArtifactId`。
- Submit 前保存提交标识，返回后保存 Job ID。提交结果不明确时用 `lookupSubmission` 查询原请求，通过 `get` 观察任务，在用户要求时显式 `cancel`，完成后用 `client.storage.assets.adoptArtifact` 保存产物。

示例对应的原生 Windows 路径不代表远程 Web/Android 或安装版已通过验收。模型范围、媒体限制及已实测组合见[本地模型指南](/zh/runtime/local-models#本地图像与视频模型)。

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
- [`examples/sdk/09-media-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/09-media-jobs.ts)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
