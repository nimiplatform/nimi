# Realm 状态投影机制

在 Nimi 的分布式架构中，客户端应用通过 SDK 提供的结构化**只读状态投影（State Projections）**消费 Realm 数据。这些结构化结果服务于当前支持的桌面端与 Web 端界面；权威数据不变量与持久化逻辑则始终由 Realm 统一治理。

## 消费端分层与不变量约束

| 分层 | 职责 | 架构考量 |
| --- | --- | --- |
| **SDK 生成核心** | 直接基于外部 Realm OpenAPI 规范编译生成 | 类型对应仓库中的契约；部署的服务版本仍需支持该契约 |
| **SDK 门面（Facade）** | 保留类型化请求、重试策略与结构化错误；受保护 App 的 Realm 凭据由 Runtime 保管 | 简化应用集成，屏蔽底层传输细节 |
| **应用与桌面端视图** | 负责渲染状态投影并维护临时 UI 缓存 | 缓存用于优化界面响应速度；权威状态仍驻留在上游 |

## 协议演进与防漂移策略

当 Realm API 跨版本演进时：
- **规范驱动重新生成**：基于更新后的 OpenAPI 规范重新编译 SDK 核心模型，以保持严格的契约一致性。
- **阻断式错误诊断（Fail-Closed Diagnostics）**：若检测到 Schema 不匹配或 API 漂移，SDK 门面将抛出结构化错误原因，引导开发者升级依赖，避免冒着客户端数据静默损坏的风险盲目继续。

## 相关文档

- [统一术语表](/zh/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
