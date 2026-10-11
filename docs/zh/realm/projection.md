# Realm 状态投影机制（Projections）

在 Nimi 的分布式架构中，客户端应用读取 Realm 数据时，通过 SDK 获取的是结构化的**只读状态视图（Projection）**。该视图用于在桌面端、Web 端或移动端呈现即时界面，而底层权威状态与数据持久化仍然由 Realm 统一治理。

## 消费端架构规范

| 架构层级 | 权责边界 | 设计理由 |
| --- | --- | --- |
| **SDK 自动生成核心** | 从配置的 Realm OpenAPI 规范自动编译生成数据模型与客户端代码 | 保证客户端与服务端数据协议的一致性与严密性 |
| **SDK 门面（Facade）** | 提供统一的身份凭据注入、断线重试及结构化错误映射 | 简化前端业务开发，屏蔽底层通信复杂度 |
| **应用与桌面端呈现层** | 负责渲染状态投影，支持本地高效缓存与列表展示 | 缓存仅用于提升界面交互响应速度，更新仍以服务端为准 |

## 接口演进与防漂移策略

当 Realm 服务端的数据结构发生版本升级或演进时：
- **规范驱动同步**：通过更新配置的 OpenAPI 输入并重新生成 SDK 核心代码，保持类型契约的严格同步；
- **优雅错误降级**：若检测到 API 契约不匹配，SDK 返回结构化错误状态，指导开发者升级客户端依赖，避免因字段类型错配导致前端静默崩溃。

## 相关文档

- [统一术语表](/zh/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
