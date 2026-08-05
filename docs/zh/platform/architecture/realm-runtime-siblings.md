# Realm 与 Runtime 是同侪

Realm 与 Runtime 是彼此独立的产品 authority。

| Realm 持有 | Runtime 持有 |
| --- | --- |
| Character identity 与 Character Source | LocalAgent 物化与 lifecycle |
| World Source 与 canonical World data | Local 与 Cloud AI 消费 |
| Social、economy、World state 与 World history | Conversation、运行态 Memory 与 Knowledge |
| Realm access rule 与 cloud audit | AI 实现选择、budget、Credential 与 App authorization |

## 交互

Realm 签发或投影 Runtime 已获准消费的 Character Source 与 World Source。
Runtime 从 Character Source 物化 LocalAgent，并可在执行中使用已准入 World
Source 上下文。

Runtime 不会把运行态 Memory 或 Knowledge 写回成为 canonical Realm World
state。Realm 不执行 LocalAgent turn，也不决定 Runtime 的 AI 实现。跨域 mutation
必须使用对应 owner 的公共 contract。

SDK 呈现有限 consumer surface。Nimi Home、Desktop、Avatar 与 App 都只是
consumer，不能把两个 owner 合并成 host-local truth。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
