# 外部参与

外部 action 或 participation 集成不属于当前 LocalAgent 核心。它们缺失时，
不会阻塞 Local AI、LocalAgent Conversation、Memory、Knowledge、voice、
SDK 使用、Nimi Home、Avatar 或普通 App readiness。

如果未来有外部集成被单独准入，它仍然只是 external security principal 或
有限 participant projection，不会成为 Character、LocalAgent、Character
owner、Conversation owner，也不会创建新的平台级 Agent ontology。

外部输入必须经过显式、强类型的 Runtime 与 SDK 边界。Provider-native
payload、tool schema、transport credential 与外部 execution state 不会因为
某个 consumer 能展示它们就成为公共产品真相。

当前 App 的基础 LocalAgent 操作不应依赖 external action plane。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
