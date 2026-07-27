# 跨 Surface 连续性

连续性来自共享的 owner truth，而不是 UI 状态同步。

Realm 提供 Character 与 Character Source。Runtime 物化 LocalAgent，并持有其
Conversation、运行态 Memory 与 Knowledge、状态及 presentation 投影。每个
surface 都只通过标准 SDK，按当前 session 与 authorization 取得有限视图。

## Surface 之间可以携带什么

- 稳定的 Character 与 LocalAgent 引用；
- 显式 Runtime Conversation anchor；
- 已提交的 Conversation 投影与强类型状态；
- 已授权的 presentation 与 voice artifact。

这些值仍然只是引用或投影，接收它们的 surface 不会因此成为 owner。

## 哪些内容保持本地

窗口布局、renderer 状态、播放控制、路由状态、输入草稿和其他短暂 UI 细节
由 consumer 自己持有。本地 cache 可以改善渲染，但不能成为恢复、
Conversation、Memory、Knowledge 或 authorization 真相。

当授权变化或 anchor 过期时，consumer 必须采用 Runtime 返回的强类型结果，
不能复制另一个 surface 的 cache 作为 fallback。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
