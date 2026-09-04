# AIConfig 与机器配置文件

## 状态：Desktop 拥有的配置界面

桌面端有两类互不相干的 AI 设置：

- Agent Center：给某个具体的 App 或 Agent 设置每项能力的 Local 或 Cloud 意图。
- Runtime 配置：管理机器 profile、provider、engine 和本地资源。

心里要把两者分开。改了机器配置，并不会给任何 App 或 Agent 绑上一个看得见的执行方式。

## Agent Center AIConfig

选定一个 App 或 Agent owner，AIConfig 区会列出各项可用能力和它当前的 Local 或 Cloud 意图。保存会整体替换这个 owner 的完整能力列表，且需要已授权的会话。

| AIConfig 拥有 | AIConfig 不拥有 |
| --- | --- |
| 准确的 owner 身份 | provider 或 model 选择 |
| 已准入能力 | 机器 route 或 connector |
| Local 或 Cloud 意图 | engine 或资源 binding |
| 已授权的整体覆盖操作 | readiness、health 或 fallback policy |

Local 和 Cloud 是意图，不是绑定。它们从不指明某个请求会由哪个 model、provider、connector、endpoint 或机器 route 执行。

## Runtime 机器配置文件

另有一个管理界面负责可移植的 `AIProfile` 包和机器本地资源，可以在那里校验、导入、安装或删除 Runtime 配置。装好的状态归 Runtime，可能影响它之后挑选实现的结果。

机器 profile 不会复制进 owner 的 `AIConfig`，不会挂到 `AIScopeRef` 上，也不会随 App 请求一起发出。请求到达时，Runtime 从可用的实现里自己挑。

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

## 记住这几点

- Agent Center 改的是你的能力意图，不是执行 profile。
- Runtime 配置管的是机器资源，不提供 App 请求的控制项。
- Desktop 有意不提供 owner 级 profile 绑定、model 路由、connector 选择、readiness 或 fallback 的界面。
- Runtime 的执行证据可以展示用于诊断，但不会成为下一次请求的输入。

## 来源依据

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
