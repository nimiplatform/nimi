# LocalAgent 访问与 App 授权

App 不会取得改变 LocalAgent 模型的产品 profile。Direct SDK consumer 与
scaffolded App 使用同一套强类型 Runtime capability surface；两者只有 host
集成方式不同，不存在两套产品 ontology。

## 从 Session 推导访问

Runtime 针对每次操作，从 active session 推导当前 account、App identity、
authorization、目标 LocalAgent 或已准入 scope，以及 requested operation。
调用方提交强类型 intent，并在需要时显式提供 LocalAgent ID。

调用方提供的 ID 只是目标，不是 ownership 或 access proof。Runtime 会拒绝
未授权或过期目标，并且不会暴露内部 session material。

## App 边界

已授权 App 可以：

- 提交强类型 LocalAgent intent；
- 读取或订阅有限的 Conversation、状态、voice、presentation、Memory 与
  Knowledge 投影；
- 观察强类型 ready、blocked、unavailable 或 failed 状态。

App 不会取得或维护 Realm JWT、Provider Credential、Runtime session proof、
私有 authorization evidence、账号级 LocalAgent 全量清单、原始 provider
event 或可重建内部上下文的材料。

Nimi Home 与 Desktop 承载当前本地 App 路径，但不会取代 Runtime 成为
authorization 或 LocalAgent owner。

## 来源依据

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
