# 平台

Nimi 把持久开放世界身份与本地 AI 执行连接起来，同时保持两者 owner 独立。

- Realm 持有 Character、social、World、economy 与 canonical World truth。
- Runtime 持有 LocalAgent 物化、AI 执行、Conversation、运行态 Memory 与
  Knowledge、voice、readiness 和 App authorization。
- SDK 是 App 的公共强类型访问边界。
- Kit 只在具体产品 consumer 需要时提供共享 UI 与 host composition。
- Nimi Home 是当前产品 home 与 Desktop host surface，但不会取代 Realm 或
  Runtime authority。
- Avatar 持有 embodiment rendering 与 shell-local interaction，不持有
  LocalAgent 或 AI 执行真相。

## Character 与 LocalAgent

用户在 Realm 创建或选择 Character。Realm 签发 Character Source，Runtime
据此物化有明确 owner 的 LocalAgent。LocalAgent 可以消费已准入 World Source
上下文，但不会成为 Realm identity 或 World truth 的 owner。

App 通过 SDK 使用 LocalAgent capability。Runtime 从 active session 推导
identity 与 authorization；App 不会取得 Realm JWT、Runtime proof、Provider
Credential 或账号级 LocalAgent 全量清单。

参见 [Character 与 LocalAgent](/zh/platform/agents/) 以及
[Realm 与 Runtime 是同侪](/zh/platform/architecture/realm-runtime-siblings)。

## 六项协议基础

六项协议基础描述可互操作的产品操作，但不会转移 owner truth：

- State
- Event
- Intent
- Action
- Audit
- Permission

参见 [协议](/zh/platform/protocol) 与
[执行协议](/zh/platform/execution-protocol)。

## 当前边界

通用 Workflow、MCP、World Evolution、Marketplace、Registry、Trust Tier、
公共分发与商业结算都不是当前 Realm–Runtime–SDK–Home–App 闭环的前置。既有
未来分发设计在不与当前 owner 边界冲突时保持隔离。

Simulator 是 selected App module 的开发与 qualification 工具，不是当前产品
平台，也不是替代产品 host。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
