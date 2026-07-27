# Owner Domain

Nimi 按 owner 分离产品真相。Projection、host、package、App、docs page 或实现
位置都不会静默取得其他 domain 的真相。

| Domain | 持有 | 不持有 |
| --- | --- | --- |
| Platform | 跨域协议与产品 owner 边界 | Realm truth、Runtime execution、App 产品行为 |
| Realm | Character、Character Source、World Source、social、economy、canonical World state 与 history | LocalAgent execution 与本地 AI routing |
| Runtime | Local 与 Cloud AI 消费、LocalAgent、Conversation、运行态 Memory 与 Knowledge、voice、readiness、Credential、本地 audit、App authorization | Realm Character 或 World truth；产品 UI |
| SDK | Runtime 与 Realm 的强类型公共 consumer projection | Provider execution、Realm truth、host-private transport |
| Kit | Demand-driven 共享 UI 与 host composition | 可复用公共 capability catalog 或 owner-domain truth |
| Nimi Home / Desktop | 当前产品 home、native host、产品 UI 与 interaction | Realm 或 Runtime authority |
| Avatar | Embodiment shell、renderer execution、playback 与 renderer-local state | LocalAgent、Conversation、Memory、Knowledge、AI routing |
| App | 自身产品行为与私有数据 | Account、grant、session、LocalAgent、Provider 或 Realm truth |
| Simulator | Selected App module 的开发 qualification | 产品 hosting、平台 readiness 或 App truth |

## 主要 Owner 转换

| 转换 | 含义 |
| --- | --- |
| Realm → Runtime | Realm 签发 Character Source，使 Runtime 可物化 LocalAgent |
| Realm → Runtime | 已准入 World Source 提供执行上下文，但不移动 World ownership |
| Runtime → SDK | 强类型、已授权 LocalAgent 与 AI 投影 |
| SDK → App | 使用公共 capability，不持有 private transport 或 proof |
| Runtime → Avatar | 强类型 presentation 与 voice 输入；渲染留在 Avatar 本地 |
| Nimi Home → App | Protected launch 与 host composition；authorization 仍归 Runtime |

## 非阻塞未来能力

通用 Workflow、MCP、World Evolution、Marketplace、Registry、Trust Tier、公共
分发与 settlement 都在当前核心闭环之外。它们缺失时，不代表 Runtime、SDK、
Nimi Home、Avatar 或普通 App readiness 失败。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
