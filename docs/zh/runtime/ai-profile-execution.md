# AI 配置文件执行

## 状态：Runtime 管理的机器配置

`AIProfile` 是可在 Desktop 间移植的配置包。Runtime 可以把已准入的配置文件投影为机器本地资源和描述符，但 App 不会把执行请求绑定到该配置文件。App 请求只携带调用者身份、场景内容和受支持的操作参数；具体实现由 Runtime 选择。

## 权责边界

| 职责 | 负责人 |
| --- | --- |
| 可移植 `AIProfile` 的结构和校验 | Desktop kernel |
| 配置文件安装及机器本地投影 | Desktop / Runtime 管理面 |
| 本地资源和设备资源管理 | Runtime |
| Owner 的能力意图（`AIConfig`） | 对应 App 或 Agent owner |
| 实现选择和资源调度 | Runtime |
| 执行诊断与审计证据 | Runtime |

`LocalProfileDescriptor` 属于机器配置，不是 App 可使用的 model、route、connector、target、fallback policy 或可复用 execution binding。SDK 不会把 App 的能力意图转换成这些请求控制项。

## App 调用路径

1. 对应 owner 在 `AIConfig` 中保存 Local 或 Cloud 能力意图。
2. App 携带身份、场景内容和受支持参数调用已准入能力。
3. Runtime 根据当前机器配置选择已准入的实现。
4. Runtime 返回强类型结果或失败。Runtime 诊断中包含的实现细节仍然只是输出证据。

修改 `AIProfile` 可能影响 Runtime 处理后续请求的方式，但不会改写 owner 意图，也不会把实现选择权交给调用者。

## 机器诊断

Runtime 管理面可以报告 daemon 连通性、已安装资源状态、资源压力和配置文件安装失败。内部解析器和调度器探针可以支撑这些诊断，但它们不会成为 App 中按 model 或 route 展示的 readiness 控制。App 也不会通过预检选择执行目标。

执行证据是 Runtime 实际行为的不可变审计信息。调用者不得把已解析 model、route decision、connector、endpoint 或 scheduling judgement 作为下一次请求的权威输入。

## 范围身份

`AIScopeRef` 标识配置或记录所属的 owner 和 surface，不标识执行实现。Scope 可以保留 Runtime 提供的证据，但不能把这些证据转换成 profile binding 或请求 target。

身份契约见 [AI 范围身份](/zh/platform/ai-scope-identity)，owner 能力意图见 [AIConfig 表面](/zh/sdk/ai-config-surface)。

## 读者场景：安装本地配置文件

1. 机器管理员校验并安装已准入的可移植配置文件。
2. Runtime 解析所需的本地资源并记录安装状态。
3. App 只保留 Local 能力意图，不接收 model 或 route selector。
4. App 下一次发起能力请求时，Runtime 判断已安装配置能否提供已准入实现，并执行或封闭失败。

## 读者场景：查看执行证据

1. App 发起不含实现控制项的能力请求。
2. Runtime 选择并执行实现。
3. Runtime 为本次尝试提供强类型诊断或审计证据。
4. Owner 可以展示或保存证据，但不能用它固定后续请求。

## 公共边界

- `AIProfile` 和 `LocalProfileDescriptor` 属于机器配置。
- `AIConfig` 是 owner 范围内的能力意图，不是执行配置文件。
- App 请求不包含 provider、model、route、connector、endpoint、target、fallback policy、profile descriptor 或 readiness probe。
- Runtime 独占实现选择、资源调度和执行证据。
- Runtime 整体连通不代表某个 model 或 route 已就绪。

## 来源依据

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
