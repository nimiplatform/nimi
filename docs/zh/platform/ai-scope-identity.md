# AIConfig 的归属

AIConfig 属于当前已认证账号下的一个规范 owner。Owner 只有两类：由规范 App 身份标识的 App，以及该账号下所有 LocalAgent 共用的 Runtime LocalAgent 子系统。

| 使用方 | 使用哪份配置 |
| --- | --- |
| 第三方 App | 该 App 自己的 AIConfig |
| Home 中的 Nimi Chat | Desktop App 的 AIConfig |
| Agent Chat，包括不同的 LocalAgent | LocalAgent 子系统共用的 AIConfig |

单个 Agent、Conversation、功能、模块、窗口、标签页或路由都不是 AIConfig owner。切换 Agent 不会切换到一份 Agent 私有 AI 配置。个性、呈现与 Memory 开关等 Agent 设置另行保存。

## 通过受保护客户端配置

App 使用 `client.aiConfig` 读取和保存自身配置；账号和 App 身份由受保护会话确定，调用者不传 owner。共享 LocalAgent 配置使用独立授权路径，需要 `agent.configure`，也不接受 Agent 选择器。Home 可以管理当前已投射给它的 App owner。

先读取配置及其不透明 revision，再携带该 revision 保存完整能力列表。省略某项能力表示清除它。出现冲突时重新读取并让用户审阅，不能自动覆盖更新的选择。

## 配置与机器选择

每项能力保存标准功能要求、可移植默认参数和明确的执行路径。Local 只有路径标记；Cloud 保存当前账号的确切 Connector 引用、CapabilityImplementation 与 Driver 定义的 provider-model target。Local Loadout 和机器当前选择属于 Runtime 的独立机器存储。

应用 AIProfile 只生成可编辑的预填内容，不会保存 AIConfig，也不会改变机器选择。保存配置与确认机器级变更是两步独立操作。不同 owner 之间没有继承或自动回退。

## 生命周期

App AIConfig 跟随 App 或产品生命周期。共享 LocalAgent 配置不会因为某个 Agent 被创建、选中或删除而消失。UI 状态和注册代次不会产生新的配置 owner。

App API 见 [AIConfig 接口](/zh/sdk/ai-config-surface)，Home 中的操作见 [AI 配置](/zh/desktop/ai-profile-config)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
