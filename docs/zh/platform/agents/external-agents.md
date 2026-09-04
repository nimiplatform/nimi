# 外部参与

外部 Agent 和外部行动集成都不在今天的 LocalAgent 核心里。没有它们，什么
都不耽误：本地 AI、LocalAgent 对话、Memory、Knowledge、语音、SDK、
Nimi Home、Avatar，以及普通 App 的能力执行，都照常运转。

如果未来有外部集成加入，它会按 Nimi 的规矩来：以一个有明确限制的外部安
全主体身份，或者以一份有限的参与者视图加入。它不会成为 Character、
LocalAgent、这两者的拥有者或 Conversation 的拥有者，也不会造出一个新的
平台级 Agent 概念。

外部输入必须经过显式、强类型的 Runtime 与 SDK 边界。服务商原生负载、工
具 schema、传输凭证和外部执行状态，不会因为某个界面能展示它们，就变成
公开的产品事实。

当前的 App 做基础 LocalAgent 操作，不需要依赖外部行动面。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
