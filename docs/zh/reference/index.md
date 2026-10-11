# 参考手册（Reference）

本手册是 Nimi 平台的概念字典与规范速查中心。各章节提供精炼的字段定义、枚举列表、状态机图谱与架构分工表格，便于开发者快速核对具体接口、参数命名与系统契约。

## 参考手册索引

| 专题手册 | 查阅内容指南 |
| --- | --- |
| [统一术语表](/zh/reference/glossary) | 平台核心概念与跨系统统一术语对照 |
| [数字世界核心字段](/zh/reference/world-fields) | 世界（World）实体的数据结构与状态定义 |
| [角色与智能体字段](/zh/reference/agent-fields) | Character 资产到 LocalAgent 运行态的映射关系 |
| [六大核心基础协议](/zh/reference/six-primitives) | 跨世界基础通信协议的规约矩阵 |
| [系统核心状态机](/zh/reference/state-machines) | 守护进程健康度、任务生命周期等核心状态机模型 |
| [权威域职责划分](/zh/reference/authority-domains) | 各子系统（Realm, Runtime, SDK, App）的数据归属边界 |
| [错误模型与分层归属](/zh/reference/error-ownership) | 错误码前缀体系、传播链路与异常处理分级 |
| [兼容性准则与版本发布](/zh/reference/compatibility-posture) | 语义化版本演进、依赖匹配与升级策略 |
| [架构不变量与误区对照](/zh/reference/forbidden-claims) | 核心设计约束、常见集成误区与正规做法 |

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
