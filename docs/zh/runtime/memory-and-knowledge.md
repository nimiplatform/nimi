# 记忆与知识

Runtime 拥有本地记忆基底与知识 bank 表面。这页讲记忆与知识怎么存、怎么分范围、怎么复制、怎么桥接到 Cognition。

## 记忆 Bank 范围

Runtime 里的记忆有类型化的 bank 范围：

| 范围 | 可见性 | 用途 |
| --- | --- | --- |
| `AGENT_CORE` | Agent 私有 | Agent 自己的长期记忆 |
| `AGENT_DYADIC` | 按关系私有 | Agent 对某个具体他者的记忆 |
| `WORLD_SHARED` | 一个世界内可见 | 世界本地的共享记忆 |
| `APP_PRIVATE` | App 基础设施范围 | App 自己的基础设施 |
| `WORKSPACE_PRIVATE` | Workspace 基础设施范围 | Workspace 本地基础设施 |

`AGENT_CORE` 与 `AGENT_DYADIC` 是世界可携带的，随 Agent 跨世界保留。`WORLD_SHARED` 按设计留在世界内。

App 可以通过 `CreateBank` 创建基础设施 bank（`APP_PRIVATE`、`WORKSPACE_PRIVATE`）。规范的 Agent 面向范围（`AGENT_CORE`、`AGENT_DYADIC`）是 Runtime 内部的 — App 通过准入合同消费它们，不直接创建。

## 记忆基底

**记忆基底**是 Runtime 私有合同，把 bank 真相绑到底层的记忆 Provider 实现上。

| 性质 | 值 |
| --- | --- |
| 默认基底 | `Hindsight`（实验性） |
| 默认模式 | 监督模式，embedding 经 llama loopback 路由 |
| 默认 Provider 准入 | 无 — 记忆 opt-in |

Runtime 出厂**不带默认记忆 Provider**。用户（或宿主产品）必须显式开启记忆。如果开了但没覆写，基底跑监督模式的 `Hindsight`。

opt-in 姿态很重要：记忆是有后果的。平台不会静默地开始存东西；用户显式授权。

## 复制

Runtime 记忆复制到 Realm，状态明确：

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待复制 |
| `synced` | 已复制到 Realm |
| `conflict` | 检测到冲突；不能服务 |
| `invalidated` | Realm 治理使缓存记忆失效；Runtime 不能继续服务 |

Realm 治理可以让缓存记忆失效。Runtime 不会继续服务一条 invalidated 的记录 — 合同是 fail-close。

想知道某次记忆写入是否持久化的 App 读 replication 状态。`pending` 写入已被准入但还未持久化；`synced` 写入已持久化；`conflict` 或 `invalidated` 状态意味着写入需要先调和、才能继续服务。

## 知识 Bank

知识 bank 是 Runtime 本地的类型化知识页，带关键字搜索、ingest 生命周期、明确的页面生命周期。

| 概念 | 是什么 |
| --- | --- |
| Bank | 命名的页面容器 |
| Page | 类型化知识单元，带内容 + 元数据 |
| Ingest | 把内容拉进来的生命周期 |
| 关键字搜索 | bank 页面之上的有界查询面 |

知识页有准入的生命周期；不存在「半成品」状态。App 通过准入查询面消费知识。

## RuntimeCognitionService 家族

Runtime 面的记忆与知识通过被吸纳的 `RuntimeCognitionService` 家族再发布。这是桥到独立 Cognition 的 Runtime 一侧。

| 概念 | 涵盖什么 |
| --- | --- |
| `RuntimeCognitionService` | Runtime 视角的记忆 + 知识 |
| 桥合同 | Runtime 怎么消费独立 Cognition |
| 升级合同 | 能力升级怎么走、不吸纳权威 |

Runtime 可以桥到独立 Cognition 用记忆与知识 — 那是消费，不是吸纳。Cognition 的权威留给自己。即便没装 Cognition，Runtime 内部的记忆与知识照样工作。

## 阅读场景：记忆 opt-in 流程

用户装了 Nimi 并创建了一个 Agent。记忆默认关。

1. **Agent 创建。** 没有 Provider 被准入。
2. **用户开启记忆。** 通过 CLI 或桌面端 Runtime 配置 opt-in。
3. **基底启动。** 默认 `Hindsight` 基底以监督模式启动。
4. **Embedding 路由。** Embedding 经 llama loopback（或配置中的准入替代品）路由。
5. **记忆写入被准入。** Agent 现在可以写到自己的 `AGENT_CORE` bank。写入按类型化状态复制到 Realm。
6. **记忆读取被准入。** Agent 在后续轮次能回忆。

用户显式授权了记忆；之前没静默存任何东西。

## 阅读场景：记忆复制冲突

某个 Agent 写了一条跟 Realm 治理冲突的记忆 — 比如某条委派路径试图把非规范化的记忆升格为规范化。

1. **本地写入被准入。** Runtime 把写入放进对应 bank 范围。
2. **复制开始。** 状态搬到 `pending`。
3. **Realm 治理拒绝。** 状态搬到 `conflict`。
4. **Runtime 不能服务。** `conflict` 意味着这条记忆 Runtime 不能继续服务。
5. **需要调和。** Agent 的记忆被调和 — 要么写入回滚，要么治理在修改后准入。

冲突不会静默地覆盖 Realm。冲突也不会静默地让本地写入失效。调和是显式的。

## 阅读场景：知识 ingest

用户把一组文档 ingest 到某个 Agent 的知识 bank。

1. **Bank 创建。** App 在合适的范围下创建 bank。
2. **Ingest pipeline。** 文档被解析；页按类型化页面生命周期被创建。
3. **页被准入。** 每页过准入的 ingest 闸口。
4. **搜索可用。** Bank 页之上的关键字搜索面被准入。
5. **查询。** Agent（或 App）查询 bank；结果是类型化的。

Ingest pipeline 受准入合同约束；没有任意 ingest 路径。

## 来源

- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
- [`.nimi/spec/runtime/kernel/knowledge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/knowledge-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-hook-trigger.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-hook-trigger.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
