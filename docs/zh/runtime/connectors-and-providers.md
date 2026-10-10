# Connector 与云端 Provider

Runtime 负责云端 Connector、凭据、Provider 目录和执行 Driver。在 Nimi Home 的「云服务」配置连接，再在对应 AIConfig 中选择其安全引用与已准入目标。

## 配置与执行

| 层次 | 包含什么 |
| --- | --- |
| Runtime Connector | 当前账号的连接、凭据托管、端点策略与生命周期 |
| AIConfig Cloud 路径 | 确切的 `connectorRef`、`implementation`、`providerModelTarget` |
| App AI 请求 | 内容和受支持参数，不含路由覆盖或凭据 |

使用绑定宿主客户端的 AIConfig 选项与设置界面。安全 Connector 引用既不是秘密，也不代表授权；Runtime 仍检查归属、App 权限、凭据有效性和策略。CLI 和独立客户端不提供另一套 Connector 托管入口。

提交 Job 时，Runtime 验证并固定已保存的 Cloud 输入。配置目标失败时不会另找 Provider 或静默替换模型。后续配置变更影响新提交；已有 Job 后续出站操作仍需满足当前权限及原 Connector 的准入条件。

## Provider 与 Driver

Runtime 目录描述已准入 Provider 家族；CapabilityImplementationDriver 把规范操作转换为具体协议。能否执行取决于确切实现、目标、功能和执行模式，不能只凭 Provider 名称判断。

App 消费强类型结果和失败。凭据、端点、原生句柄和私有协议状态不会进入 App 结果或存储。安全配置选项与执行证据不授予请求级覆盖权。

## 处理云端失败

1. 查看该能力已提交的 AIConfig 和 Runtime 返回的实际配置状态。
2. 在「云服务」检查引用的连接，通过受保护流程修正凭据或可用性。
3. 如需换目标，携带当前 revision 保存完整 AIConfig。
4. 新工作由 App 明确发起；已有异步 Job 应观察原身份，不能重新提交来恢复。

另见 [凭据托管](/zh/runtime/key-source-routing) 与 [本地模型](/zh/runtime/local-models)。

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
