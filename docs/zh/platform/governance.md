# 平台治理

Nimi 把持久身份、世界真相、AI 执行、呈现与 App 组合交给不同 owner。
产品表面可以组合这些能力，但不能悄悄接管它们。

## Owner 对照

| 关注点 | 产品 owner |
| --- | --- |
| 世界身份、历史与持久 Character 身份 | Realm |
| LocalAgent 执行、Conversation、Memory、Knowledge | Runtime |
| 面向 App 的强类型访问 | SDK |
| 当前第一方 home 与产品 UI | Nimi Home / Desktop |
| 形体呈现 | Avatar |
| 可复用 consumer UI | Kit |
| 开发者验证表面 | Simulator |

Character 与 LocalAgent 最能说明这条边界。Realm 持有持久 Character，
Runtime 为执行物化 LocalAgent。Desktop store、Avatar instance 或 App
binding 可以引用它们，却不会成为第三个身份 owner。

## App 边界

App 从当前 session 与 app identity 获得 Runtime 能力，不接收 Realm
credential，也不自行维护 Runtime proof。Realm 访问通过准入的 SDK 或宿主
表面；Conversation、Memory 与 Knowledge 继续由 Runtime 提供。

Nimi Home 是当前第一方宿主，负责把多个 owner 组合成产品体验。替换宿主
不会把这些 owner 的真相迁入宿主。

## 延期能力

通用 Workflow、MCP、World Evolution、Marketplace、公共 Registry、
Trust Tier 与商业结算都不是当前 Local AI 和 Windows 产品闭环的前置。
未来设计在 owner 与激活边界明确前保持隔离。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
