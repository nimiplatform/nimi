# App 协作

Nimi App 通过用途明确的受保护操作协作。正式 App 没有通用的 `SendAppMessage` / `SubscribeAppMessages` 总线、任意接收方路由或通向内部 Agent 载体的 token 捷径。

## 按任务选择接口

| 任务 | App 接口 |
| --- | --- |
| 调用其他 App 或外部服务提供的操作 | `client.integration`，需要实际 provider 和用户授予的持续权限 |
| 与已授权 LocalAgent 对话 | `client.conversation`，使用当前 Agent handle |
| 为 App 项目执行独立 Agent 工作 | `client.agentWork`，使用单独准入的声明与访问权限 |
| 发布或查看受支持的 App 活动记录 | `client.activity`，遵循发布方、可见性和记录生命周期规则 |

这些接口的输入、结果和生命周期不同。活动记录不是 RPC 回复，Conversation 消息也不能承载任意 App 业务命令。

## 示例：查询其他 App 的空闲时间

如果日历 App 已提供查询空闲时间的 Integration 操作，通过 `client.integration` 发现它及其 schema。由用户授予相应目标/操作权限，再用符合 schema 的输入调用，并观察原调用。日历数据及业务 handler 归日历 App，结果如何用于项目归调用方 App。

Provider 或权限缺失时展示真实不可用或拒绝结果，不能改造一个通用 `free-time-query` 消息或打开私有 Runtime 传输。完整边界见[集成](/zh/runtime/integrations)。

## 内部 Agent 载体

Runtime 为自身执行保留私有、固定子类型的 Agent 输入与结果载体。实现和生成类型中保留 wire/service 名称，不等于它们是公共 App 操作。普通公开传输拒绝这些消息 RPC，受保护 Local App 调用也会被拒绝。

对话和实时交互使用各自的规范操作。当前会话准入、调用者填写的 App ID 或已知内部消息名，都不能扩大 App 的操作集合。

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform.ts)
