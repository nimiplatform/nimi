# 记忆与知识

Runtime 持有本地记忆底座，也持有知识库这一公开面。本页讲清楚记忆与知识如何分作用域存放、如何复制、如何与 Cognition 对接。

## 记忆库的作用域

Runtime 把记忆按照强类型作用域来分库：

| 作用域 | 可见范围 | 用途 |
| --- | --- | --- |
| `AGENT_CORE` | Agent 私有 | Agent 自己的长期记忆 |
| `AGENT_DYADIC` | 一对一关系私有 | Agent 对某一个特定对象的记忆 |
| `WORLD_SHARED` | 单个世界内部可见 | 该世界本地的共享记忆 |
| `APP_PRIVATE` | App 基础设施作用域 | App 侧的基础设施 |
| `WORKSPACE_PRIVATE` | 工作区基础设施作用域 | 工作区本地的基础设施 |

`AGENT_CORE` 与 `AGENT_DYADIC` 是跨世界可携带的，会随 Agent 在世界之间迁移。`WORLD_SHARED` 按设计始终留在原世界。

App 可以通过 `CreateBank` 创建基础设施类的库（`APP_PRIVATE`、`WORKSPACE_PRIVATE`）。面向 Agent 的核心作用域（`AGENT_CORE`、`AGENT_DYADIC`）由 Runtime 内部管理；App 通过准入契约去消费它们，不能直接创建。

## 记忆底座

**记忆底座**是一份 Runtime 私有契约。它把库的真值绑定到一个底层记忆 provider 实现。

| 属性 | 值 |
| --- | --- |
| 默认底座 | `Hindsight`（实验性） |
| 默认模式 | 监督模式，嵌入向量通过 llama loopback |
| 默认 provider 准入 | 无；记忆默认关闭 |

Runtime 不预装任何默认记忆 provider。用户或宿主产品必须显式开启记忆。开启时若没有指定 provider，底座会以监督模式运行 `Hindsight`。

这种"默认关闭、用户主动开启"的姿态有意为之：记忆是有后果的事情，平台不会悄悄开始存东西，授权一定要落在用户手上。

## 复制

Runtime 的记忆向 Realm 复制时，状态是显式的：

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待复制 |
| `synced` | 已复制到 Realm |
| `conflict` | 检测到冲突；不可对外服务 |
| `invalidated` | Realm 治理判定缓存失效；Runtime 不能继续提供 |

Realm 治理可以让缓存的记忆失效。一旦标为失效，Runtime 不能继续对外提供这条记录，契约是 fail-closed 的。

App 想知道一次记忆写入是否已经持久化，就读复制状态。`pending` 表示已准入但还未持久；`synced` 表示已持久；`conflict` 与 `invalidated` 都意味着这次写入需要先和解，才能恢复对外服务。

## 知识库

知识库是 Runtime 本地的强类型知识页面集合，配套关键字检索、入库生命周期，以及清晰的页面生命周期。

| 概念 | 含义 |
| --- | --- |
| Bank | 命名的页面容器 |
| Page | 带内容与元数据的强类型知识单元 |
| Ingest | 把内容引入库的生命周期 |
| 关键字检索 | 库内页面的有界查询面 |

每个知识页面都处在准入过的生命周期状态里，不存在"半成品"中间态。App 通过准入的查询面消费知识。

## RuntimeCognitionService 家族

Runtime 端的记忆与知识，会通过吸纳进来的 `RuntimeCognitionService` 家族再公开一次。这一层是 Runtime 通往独立 Cognition 的接桥。

| 概念 | 涵盖范围 |
| --- | --- |
| `RuntimeCognitionService` | Runtime 视角下的记忆与知识 |
| 桥接契约 | Runtime 怎么消费独立 Cognition |
| 升级契约 | 能力升级如何流入，且不会吞掉 Cognition 的权威 |

如果装了独立 Cognition，Runtime 可以接桥过去取记忆与知识。这是消费，不是吞并。Cognition 的权威仍归它自己。如果没装 Cognition，Runtime 内部的记忆与知识照样能用。

## 场景：开启记忆

用户安装 Nimi 并创建一个 Agent。记忆默认是关闭的。

1. **Agent 已创建。** 没有记忆 provider 被准入。
2. **用户开启记忆。** 通过 CLI 或桌面端的 Runtime 配置完成开启。
3. **底座启动。** 默认 `Hindsight` 底座以监督模式启动。
4. **嵌入路由。** 嵌入向量经 llama loopback（或已配置的替代项）路由。
5. **写入开通。** Agent 现在可以向自己的 `AGENT_CORE` 库写入。写入按强类型状态向 Realm 复制。
6. **读取开通。** 后续轮次中，Agent 可以回忆这些记忆。

授权是用户给的；在此之前没有任何静默存储。

## 场景：复制冲突

Agent 写下一条记忆，与 Realm 端治理产生了冲突。例如某条受委派路径试图把非规范记忆提升为规范记忆。

1. **本地写入准入。** Runtime 接受该写入，落入相应作用域的库。
2. **复制开始。** 状态进入 `pending`。
3. **Realm 治理拒绝。** 状态切到 `conflict`。
4. **Runtime 停止服务。** `conflict` 状态意味着这条记录不能继续对外提供。
5. **需要和解。** Agent 的记忆要通过和解流程：要么回滚写入，要么治理以修正后的条款重新准入。

冲突不会静默覆盖 Realm，也不会静默废弃本地写入。和解必须显式发生。

## 场景：知识入库

用户把一组文档导入到某个 Agent 的知识库。

1. **建库。** App 在合适的作用域下创建 Bank。
2. **入库流水线。** 文档被解析；Page 在强类型生命周期下被创建。
3. **Page 准入。** 每个 Page 通过准入的入库门控。
4. **检索可用。** Bank 上的关键字检索面被开放。
5. **查询。** Agent 或 App 对库做查询，结果是强类型的。

入库流水线由准入契约约束，任意自由形式的入库路径不被准入。

## 来源依据

- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
- [`.nimi/spec/runtime/kernel/knowledge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/knowledge-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-hook-trigger.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-hook-trigger.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
