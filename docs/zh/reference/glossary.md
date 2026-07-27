# 术语表

## 身份与执行

**Character。** Realm 持有的持久 identity 与 social/world truth。
PersonaCharacter 与 WorldCharacter 是 Character 形态。

**Character Source。** Realm 签发、可供 Runtime 物化 LocalAgent 的身份来源。

**World Source。** Realm 持有的 World 上下文来源。它可以贡献 context，但不能
单独建立 LocalAgent identity。

**LocalAgent。** 有明确 owner 的 Runtime 本地 AI 执行物化。它不持有 Realm
identity 或 World truth。

**Conversation anchor。** 一条 LocalAgent Conversation 的显式 Runtime-owned
identity。一个 LocalAgent 可以有多条 Conversation。

**运行态 Memory。** Runtime 持有的 LocalAgent recall、retention、isolation
与 authorized projection。

**运行态 Knowledge。** Runtime 持有的 LocalAgent ingestion、retrieval、
isolation、lifecycle 与 authorized projection。

## 产品 Surface

**SDK。** Runtime 与 Realm consumer 的强类型公共访问边界。

**Kit。** Demand-driven 共享 UI 与 host composition，不是预建所有可能产品
capability 的 catalog。

**Nimi Home。** 当前产品 home 与 Desktop host surface。Host 角色不会使它
成为 Realm 或 Runtime owner。

**Avatar。** Embodiment shell 与 rendering owner。Avatar 消费强类型 Runtime
presentation input，并持有 renderer-local behavior。

**Simulator。** Selected App module 的开发 qualification 工具，不是当前产品
平台或产品 host。

## 访问与失败

**Session-derived access。** Runtime 从 active session 推导 account、App
identity、authorization、目标 LocalAgent 或 scope，以及 operation。

**Typed unavailable。** 明确表示可选或不适用 capability 不可用的结果，不是
synthetic success。

**Projection。** Owner 提供的有限视图。Projection 不会把 ownership 转移给
consumer。

**Owner。** 对某项产品真相及其 mutation rule 负责的 domain。Code location、
package name、docs、cache 或 host role 都不能创建 ownership。

## 六项协议基础

**State。** 由 owner 控制的当前产品条件。

**Event。** Owner 投影的强类型 occurrence。

**Intent。** 请求结果的强类型表达，不是 authorization proof。

**Action。** 由 owning domain 执行的已准入 operation。

**Audit。** Owner 控制的安全或产品相关活动记录。

**Permission。** Owner 对 scoped operation 作出的授权决定。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
