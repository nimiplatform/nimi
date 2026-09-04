# Connector 与 Provider

Connector 和 provider 属于 Runtime 管理的云端配置。它们描述 Runtime 如何访问已准入的云端实现，不是 App 请求控制项，也不会进入 owner `AIConfig`。

Runtime 管理的本地资源见 [本地模型](/zh/runtime/local-models)。

## Connector

Connector 是已准入云端 provider 的机器侧身份和凭据记录。创建、校验、保存、吊销和使用都由 Runtime 管理。

| 属性 | 归属 |
| --- | --- |
| 凭据保管 | Runtime daemon 配置 |
| Provider 身份 | Runtime 目录 |
| 校验和生命周期 | Runtime |
| 能力兼容性 | Runtime 目录和 Driver |
| 请求执行时的 connector 选择 | 仅 Runtime |

App 不会创建请求级 connector，不传 connector id，不读取 connector 的模型清单，也不能把 connector 诊断当成路由权威。Desktop 和 CLI 可以向机器所有者提供 connector 管理功能，但该界面修改的是 Runtime 配置，不是 App 契约。

## Provider 与 Driver

Provider 是已准入的云端实现家族。Runtime Driver 把规范能力操作转换成 provider 专属调用，并规整结果、流、错误和证据。

| 来源 | 用途 |
| --- | --- |
| `provider-catalog.yaml` | Runtime 已准入的 provider 家族 |
| `provider-capabilities.yaml` | Runtime 能力兼容性 |
| `provider-extension-registry.yaml` | 已准入的 Runtime/Driver 扩展 |

Provider 和实现目录属于 Runtime 权威。App 使用规范能力表面，不选择目录中的某一行。因此，增加 provider 支持或修改 Driver 不要求 App 重写请求。

## 凭据保管

Provider 凭据只保存在 Runtime 配置或已准入的宿主保管机制中。普通能力请求不包含 provider 凭据、凭据 selector、connector id、provider id 或 endpoint。Runtime 在准入调用者和能力后，自行解析所需凭据。

凭据和 provider 原生句柄不得泄漏到规整后的 SDK 结果、日志或 App 存储。凭据缺失或无效时返回强类型失败，客户端不会合成 fallback。

## Health 与诊断

Runtime 可以监控 provider 和 connector 状态，用于机器管理和内部实现选择。`nimi doctor` 可以指出受影响的 Runtime 区域，但不会向 App 授予 provider health 或 route readiness 控制。

App 支持的信号只有：

- Runtime 整体连通性；
- 所请求能力的强类型结果或失败；
- 操作契约包含的 Runtime 执行诊断。

这些诊断只解释 Runtime 已经做了什么，不能授权 App 在下一次请求中固定或切换 provider、connector、model、route 或 endpoint。

## 读者场景：配置云端能力

1. **配置 Runtime。** 机器管理员通过 Desktop 或 CLI 添加已准入的 provider 凭据。
2. **校验。** Runtime 校验配置并按自身保管边界保存。
3. **表达 owner 意图。** App 或 Agent owner 在 `AIConfig` 中为已准入能力记录 Cloud 意图，不指定 provider 或 connector。
4. **调用。** App 发送调用者身份、场景内容和受支持的操作参数。
5. **执行。** Runtime 选择已准入实现和凭据记录，并返回强类型结果或失败。

## 读者场景：Provider 退化

1. Runtime 在处理请求时检测到上游异常。
2. Runtime 按已准入执行策略完成操作，或发送强类型终止失败。
3. Runtime 将 provider 和 connector 细节记录为内部诊断或审计证据。
4. App 展示操作结果，不提供 provider 切换器，也不伪造成功。
5. 机器管理员可以在管理界面检查并修复 Runtime 配置。

## 记住这几点

- Connector、provider 目录、凭据、endpoint 和 Driver 都属于 Runtime 配置。
- `AIConfig` 的 Cloud 意图不选择其中任何一项。
- App 请求不包含 provider、connector、model、route、target、endpoint、credential 或 fallback policy。
- Provider health 和 route readiness 不是 App 选择表面。
- Runtime 独占实现选择；没有已准入实现可执行时返回强类型失败。

## 来源依据

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`config/runtime-provider-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-catalog.yaml)
- [`config/runtime-provider-capabilities.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-capabilities.yaml)
- [`config/runtime-provider-extension-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-extension-registry.yaml)
