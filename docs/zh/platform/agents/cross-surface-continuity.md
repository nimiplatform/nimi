# 跨 Surface 连续性

换一块屏幕，对话还在原处。这种连续性来自 Realm 和 Runtime 共同保存的同
一份内容，而不是几个界面互相同步 UI 状态。

Realm 提供 Character 和 Character Source。Runtime 运行 LocalAgent，并保
存它的 Conversation、运行态 Memory 与 Knowledge、状态和呈现输出。每个
surface 都通过标准 SDK，按当前会话和授权范围拿到一份有限的视图。

## Surface 之间可以携带什么

- 稳定的 Character 与 LocalAgent 引用；
- 显式的 Runtime Conversation anchor；
- 已提交的 Conversation 视图和强类型状态；
- 已授权的呈现与语音产物。

接收方拿到的是引用和视图，不是它们所指内容的所有权。

## 哪些内容保持本地

窗口布局、renderer 状态、播放控制、路由状态、输入草稿和其他短命的 UI
细节，都由使用方自己保存。本地缓存可以让渲染更快，但它代替不了恢复、
Conversation、Memory、Knowledge 或授权数据。

授权发生变化或 anchor 过期时，使用方必须采用 Runtime 返回的强类型结
果。把另一个 surface 的缓存复制过来，不是退路。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
