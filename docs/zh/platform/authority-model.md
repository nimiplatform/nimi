# 权威模型

Nimi 把持久身份、Runtime 执行、产品宿主与呈现分开，避免任何投影
悄悄变成它所投影真相的 owner。

字段级 owner 对照见
[Reference → 权威域](/zh/reference/authority-domains)。

## 核心 owner

| 关注点 | Owner | 边界 |
| --- | --- | --- |
| 账户级 AI 身份 | Realm `Character` | Realm 持有持久身份与世界关系 |
| AI 执行物化 | Runtime `LocalAgent` | Runtime 为本地执行物化 Character |
| Conversation、Memory、Knowledge | Runtime | App 消费服务，不接管其真相 |
| 世界真相与历史 | Realm | Runtime 与 App 使用准入的 Realm 表面 |
| App 授权 | Runtime session | 访问权由当前 session 与 app identity 派生 |
| 产品组合 | Nimi Home 与其他宿主 | 当前宿主负责组合，但可以被替换 |
| 形体与渲染 | Avatar | Avatar 负责呈现投影，不成为 Character 或 LocalAgent owner |

`Character` 与 `LocalAgent` 有关联，但不能互换。Character 是 Realm
中的持久身份；LocalAgent 是 Runtime 持有的可执行物化。App 可以通过
准入 API 持有引用，但 projection 或 binding 对象不会因此成为第三个
身份 owner。

## App 访问

App 通过当前 session 与自身 app identity 获得 Runtime 能力。
Scaffolded App 不接收 Realm JWT，也不自行维护 Runtime proof。Realm
访问通过准入的 SDK 或宿主表面中介；Runtime 继续持有执行、
Conversation、Memory 与 Knowledge。

Direct SDK 与 Scaffolded App 是接入路径，不是用户选择的产品
profile。Kit 只在真实 consumer 需要时提供可复用产品面，不为“体系
完整”预建公共目录。

## 宿主与投影

Nimi Home 是当前第一方产品宿主。它可以组合 Runtime、Realm、SDK、
Kit 与 Avatar，但不会替代这些 owner。Desktop shell state、Avatar
projection、Simulator 报告和生成配置同样只是 owner truth 的
consumer 或 projection。

既有公共分发和 App-world binding 设计在不直接冲突时保持隔离，
不成为当前 Windows 产品闭环的前置。

## 可选外部动作

外部委派动作是可选能力边界。启用时，授权必须保持带作用域并
fail closed；Workflow、MCP、World Evolution、公共 Registry 或
Marketplace 分发都不是当前 Runtime 前置。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
