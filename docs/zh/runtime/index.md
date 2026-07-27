# Runtime

Runtime 是独立的本地服务，负责把已授权的产品 intent 转成 AI 执行。App 通过
SDK 使用它的公共 capability surface，不能导入 Runtime internal，也不能直接
调用 Provider。

## Runtime 持有什么

Runtime 持有：

- Local 与 Cloud AI 消费、Provider 与 Model 路由、readiness、Token、Quota、
  Budget 及 Credential custody；
- 从 Realm 签发的 Character Source 物化 LocalAgent，并管理其生命周期；
- LocalAgent Conversation、运行态 Memory 与 Knowledge、状态、voice、event
  和 presentation 投影；
- 本地 process、model、service、stream 与 audit 行为；
- 从 active protected session 推导的 App identity 与 authorization；
- 通往独立 Realm 及可选外部能力的有限 bridge。

无论 consumer 是 Nimi Home、Desktop、Avatar、Direct SDK Client 还是
scaffolded App，这些职责都不会从 Runtime 转移出去。

## Runtime 不持有什么

Realm 持有 Character identity、Character Source、World Source、canonical
World data、social truth 与 World history。Runtime 可以消费已准入的 source
context，但不能重新定义它。

App 与第一方 surface 持有自己的产品 UI、交互和短暂 cache。它们不能接管
Conversation、Memory、Knowledge、LocalAgent、Provider、Credential、session
或 authorization 真相。

通用 Workflow、MCP 与 World Evolution 都不是 Runtime 核心前置。可选的
external action capability 应单独报告 unavailable，不得阻塞 LocalAgent
Conversation、Memory、Knowledge、voice 或普通 readiness。

## 阅读路径

- [流式传输](/zh/runtime/streaming)
- [多模态执行](/zh/runtime/multimodal)
- [Agent 执行](/zh/runtime/agent-execution)
- [Memory 与 Knowledge](/zh/runtime/memory-and-knowledge)
- [Connector 与 Provider](/zh/runtime/connectors-and-providers)
- [本地 Model](/zh/runtime/local-models)
- [Account 与 Session](/zh/runtime/account-and-session)
- [委派能力](/zh/runtime/delegated-capability)
- [本地审计](/zh/runtime/audit-local)

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
