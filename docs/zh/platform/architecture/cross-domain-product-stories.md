# 跨域产品故事

以下故事说明 owner 边界如何组合成用户可见流程。

## 创建 Character 并使用 LocalAgent

1. 用户在 Realm-owned 产品 surface 创建或选择 Character。
2. Realm 产生 Character Source。
3. Runtime 从该 source 物化有明确 owner 的 LocalAgent。
4. Nimi Home 或 App 只通过 SDK 取得已授权 LocalAgent 投影。
5. Runtime 在自己的 owner 边界内保留 Conversation、运行态 Memory 与
   Knowledge、route、readiness 与 Credential。

Host 不创建 Character identity，Realm 也不执行 LocalAgent。

## 在另一 Surface 继续 Conversation

1. Runtime 创建 Conversation 并返回显式 anchor。
2. Desktop 渲染 committed turn，并保留短暂 UI state。
3. Avatar 把可见 instance 连接到同一条已授权 anchor。
4. Runtime 仍是 continuity owner；两个 surface 都不能复制本地 history 作为
   recovery truth。

Renderer motion 与 playback 留在 Avatar 本地。Conversation、voice、状态与
presentation timing 仍是 Runtime 投影。

## 使用 Scaffolded App

1. Nimi Home 通过当前 protected local path 启动 App。
2. App 经标准 SDK 提交强类型 intent 与显式 LocalAgent target。
3. Runtime 从 active session 推导 account、App identity、authorization 与
   access。
4. App 只收到有限强类型结果，不会取得 Realm JWT、Provider Credential、
   Runtime proof 或账号级 LocalAgent 全量清单。

Direct SDK 与 scaffolded App 共享这份产品 contract。Host 集成不是用户可选的
产品 profile。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
