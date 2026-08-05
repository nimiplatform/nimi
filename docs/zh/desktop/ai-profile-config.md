# AIConfig 与机器配置文件

## 状态：Desktop 拥有的配置界面

Desktop 展示两类彼此独立的配置：

- Agent Center 展示 owner 范围内的 `AIConfig` 能力意图。
- Runtime 配置界面管理机器 profile、provider、engine 和本地资源。

两者不能混为一体。应用机器配置不会创建 App 或 Agent 可见的 execution binding。

## Agent Center AIConfig

对于准确的 App 或 Agent owner，AIConfig section 展示各项已准入能力及其 Local 或 Cloud 意图。保存操作通过已授权 session，整体替换该 owner 的完整能力列表。

| AIConfig 拥有 | AIConfig 不拥有 |
| --- | --- |
| 准确的 owner 身份 | provider 或 model 选择 |
| 已准入能力 | 机器 route 或 connector |
| Local 或 Cloud 意图 | engine 或资源 binding |
| 已授权的整体覆盖操作 | readiness、health 或 fallback policy |

Local 和 Cloud 是能力意图，不标识执行请求的 model、provider、connector、endpoint 或机器 route。

## Runtime 机器配置文件

Desktop 可以为可移植 `AIProfile` 包和机器本地资源提供独立管理界面。该界面可以校验、导入、安装或删除 Runtime 配置。结果归 Runtime 所有，并可能影响 Runtime 对后续请求的实现选择。

机器 profile 不会复制到 owner `AIConfig`，不会附着到 `AIScopeRef`，也不会随 App 请求发送。请求到达时，Runtime 从已准入实现中自行选择。

## 读者场景：设置 Agent 能力意图

1. **打开 Agent Center。** Session 加载准确 Agent owner 的完整 `AIConfig`。
2. **选择意图。** 用户把一项已准入能力设为 Local 或 Cloud。
3. **保存。** 已授权的整体覆盖操作替换该 owner 的完整能力列表。
4. **后续调用。** Agent 只提交身份、场景内容和受支持参数，不提交 profile、model、route 或 connector。
5. **Runtime 执行。** Runtime 结合当前机器配置解释能力意图，并返回强类型结果或失败。

## 读者场景：安装机器配置文件

1. **打开 Runtime 配置。** 用户查看 Runtime 拥有的 profile 和资源。
2. **安装或更新。** Runtime 校验并应用机器配置。
3. **Owner 意图保持不变。** App 或 Agent 配置不会被重新绑定。
4. **后续请求。** Runtime 可以考虑新的机器状态，同时继续独占实现选择权。

## 公共边界

- Agent Center 编辑 owner 能力意图，不编辑执行 profile。
- Runtime 配置管理机器资源，不提供 App 请求控制项。
- Desktop 不提供 owner 级 profile binding、model routing、connector 选择、readiness 或 fallback UI。
- Runtime 执行证据可以用于诊断展示，但不能成为下一次请求的输入。

## 来源依据

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
