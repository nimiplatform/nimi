# Conversation Anchor

Conversation anchor 标识一条由 Runtime 持有的 LocalAgent Conversation。它
不是 LocalAgent 身份本身，也不能从 UI 路由、Avatar instance、本地 transcript
cache 或某个 surface 最近展示的 LocalAgent 推断出来。

Runtime 持有 Conversation 的创建、提交、快照、恢复、中断与投影。同一个
LocalAgent 可以有多条 Conversation，因此 consumer 必须保留标准 SDK surface
返回的显式 anchor。

## 创建与恢复

调用方提交强类型 intent 与显式 LocalAgent 目标。Runtime 在创建或恢复
Conversation 前，从当前 session 推导 account、App identity、authorization
以及 ownership 或 access。

恢复只使用 Runtime 持有的 anchor 与 snapshot。本地消息历史只是 UI cache，
不能证明连续性，也不能重建 Conversation、Memory 或 Knowledge 真相。

## 投影边界

已授权 consumer 可以取得当前 Conversation 的 committed turn 与有限状态。
原始 provider 输出、parser payload、credential、内部 prompt 和 Runtime proof
保持私有。

Avatar 可以为了呈现而把可见 instance 连接到已授权 Conversation，但 launch
ID 与 renderer 状态都不能创建或证明该 Conversation。

## 来源依据

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
