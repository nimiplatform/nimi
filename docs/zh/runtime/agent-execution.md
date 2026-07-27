# LocalAgent 执行

Runtime 持有 LocalAgent 物化与执行。LocalAgent 从 Realm 签发的 Character
Source 物化，并绑定显式 owner；它不是第二套 Realm 身份，平台也不存在默认
LocalAgent。

## 执行边界

Runtime 持有：

- LocalAgent 物化、生命周期与 owner 隔离；
- Conversation anchor、committed turn、恢复与中断；
- 运行态 Memory 与 Knowledge；
- AI route、readiness、Quota、Budget 与 Provider Credential custody；
- model output 在成为 Conversation、状态、voice 或 presentation 真相前的校验；
- 面向已授权 consumer 的强类型投影。

App 通过 SDK 提交强类型 intent。Runtime 从 active session 推导 account、
App identity、authorization 与 LocalAgent access。调用方提供的 LocalAgent ID
只是目标，不是 access proof。

## Consumer 边界

App、Desktop、Nimi Home 与 Avatar 可以渲染已授权的 Conversation、状态、
voice 与 presentation 投影。它们不能消费原始 Provider 或 parser output、
维护 Runtime proof、从 UI history 重建 Memory 或 Knowledge，也不能创建
LocalAgent success。

Avatar 消费强类型 embodiment input，只持有 shell interaction、renderer
execution、playback 与短暂 visual state。

## 连续性

每条 Conversation 都有显式、Runtime-owned anchor。一个 LocalAgent 可以拥有
多条 Conversation；从同一 Character Source 物化的多个 LocalAgent 仍保持
独立运行态状态。

参见 [Conversation Anchor](/zh/platform/agents/conversation-anchor) 与
[LocalAgent 访问](/zh/platform/agents/participation-authority)。

## 来源依据

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
