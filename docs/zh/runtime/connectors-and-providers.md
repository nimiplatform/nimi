# 云端连接器与模型供应商（Connectors & Providers）

本地 Runtime 统一管理所有通往第三方云端大模型的连接器（Connectors）、供应商目录（Provider Catalog）以及底层协议执行驱动（Drivers）。用户可在 Nimi Home 的「云服务」中集中配置各个服务商的 API 连接，随后在具体应用的 AIConfig 中将能力路由指向对应连接器。

## 架构分层与职责划分

| 架构层级 | 管理内容 | 安全与生命周期 |
| --- | --- | --- |
| **Runtime 连接器（Connector）** | 第三方 API Key、自定义接入端点与网络重试策略 | 密钥由 Runtime 集中保存在受保护的本地存储中，不暴露给前端或渲染进程 |
| **AIConfig 云端路由** | 关联的连接器引用（`connectorRef`）与目标模型名（`providerModelTarget`） | 作为应用级配置持久化保存，只存储安全引用标识 |
| **应用调用层（App Request）** | 业务请求内容与提示词参数 | 仅需关注业务逻辑，完全与底层 API 协议与认证细节解耦 |

通过由本地 Runtime 统一托管敏感密钥，第三方应用无需自行处理 API 鉴权、跨域网络请求或密钥泄漏风险。

## 驱动转换与标准化调度

- **协议转换**：Runtime 内置的 `CapabilityImplementationDriver` 将平台统一的标准操作转换为各服务商私有的 HTTP、WebSocket 或 gRPC 协议。
- **确定性路由**：任务提交时，Runtime 严格按照已配置的目标模型发起调用。若云端服务发生网络中断或配额耗尽，系统将直接返回具体错误，避免静默切换至未经验证的替代模型造成幻觉或计费争议。
- **结构化结果输出**：应用层消费归一化后的生成流与结构化结果，底层供应商专有的原始 Header 与私有字段被安全过滤。

## 云端调用异常排查指南

当云端调用失败时，建议按以下步骤排查：

1. **检查配置状态**：确认当前应用绑定的 AIConfig 中所指定的 Connector 是否处于启用状态。
2. **测试连接健康度**：在「云服务」面板中点击“测试连接”，验证 API 密钥有效性与网络连通性。
3. **核查服务商配额**：检查对应云端平台（如 OpenAI、Anthropic）账户是否有充足余额或达到速率限制。
4. **调整或切换模型**：如需更换模型接入点，可在应用的 AI 配置面板中更新目标并保存生效。

## 相关文档

- [密钥源与凭据路由机制](/zh/runtime/key-source-routing)

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
