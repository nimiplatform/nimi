# Runtime 客户端

Nimi App 使用一个绑定宿主的 `NimiLocalAppClient`，通常由生成的 Kit 集成创建。使用 `client.ai`、`client.aiConfig` 和分别准入的 App 能力接口；App 不选择账号、App owner、Runtime 地址或受保护传输。

`@nimiplatform/sdk/runtime` 也向宿主及已准入基础设施提供强类型 Runtime 功能。导入类型或构造直连客户端不会授予 App 权限。普通 loopback gRPC 拒绝 App 范围的 AI 执行、AIConfig 和存储操作，不能作为另一条 App 接入路径。

## 请求与结果

AI 请求携带内容和受支持参数。已保存 AIConfig 提供 Local 或 Cloud 路径，Runtime 在提交时固定选中的 Local Loadout 或确切 Cloud 配置。SDK 不寻找替代实现，也不注入凭据。

流返回有序强类型输出和终止结果。异步 Job 使用 Submit、反复 Get、完整结果读取与明确 Cancel。观察失败时保留原 Job 身份，不能为恢复连接而重新提交工作。见[流式](/zh/runtime/streaming)。

LocalAgent 操作使用会话级已授权 handle。Conversation、业务执行、共享配置、Memory 管理和实时操作分别保留各自权限覆盖。长期 Memory 归 Cognition，经 Runtime 中介；Knowledge V1 没有公共客户端接口。

## 处理失败

保留强类型错误、原因及可用行动提示。数据非法或权限缺失时拒绝执行。缺少方法或不支持的组合，都不能通过 Runtime 内部接口或 Provider 直连绕过。

接入从[第一次 AI 调用](/zh/sdk/first-ai-call)、[AIConfig](/zh/sdk/ai-config-surface) 和 [App 授权](/zh/platform/agents/participation-authority) 开始。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
