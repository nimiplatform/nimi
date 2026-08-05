# 架构

Nimi 由多个同侪 owner domain 组成，并通过强类型投影连接。

```text
Realm Character 与 World truth
            |
            | Character Source / World Source
            v
Runtime LocalAgent 与 AI 执行
            |
            | SDK typed capability projection
            v
Nimi Home / Desktop / Avatar / Third-party App
```

Realm 与 Runtime 相互独立。Runtime 不会变成 Realm subsystem，Realm 也不会
成为本地 AI executor。SDK 是 consumer boundary，不是凌驾于两者之上的第三
authority。

Nimi Home 承载当前本地 App 流程，并组合公共 SDK 与 demand-driven Kit
surface。Scaffolded App 获得 session-derived access，而不是 protected
Credential 或 Runtime proof。

Avatar 消费强类型 Runtime presentation input，并保留 renderer-local state。
Simulator 用于 selected App module 的开发 qualification；两者都不是平台 owner。

## 架构规则

- Character identity 与 World truth 留在 Realm。
- LocalAgent、Conversation、Memory、Knowledge、AI implementation selection 与
  App authorization 留在 Runtime。
- App 使用公共 SDK operation，只持有自身产品行为与数据。
- Desktop 是当前 host，不是不可替代的跨平台 authority。
- Platform security 表达必要结果；除非公共 contract 要求，OS 机制保持为
  owner implementation detail。
- 延期能力不阻塞当前产品闭环。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
