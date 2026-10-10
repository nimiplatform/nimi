# 跨 World 身份

角色在每个世界里都是它自己。这种连续性存在于 Realm 的 Character 身份
里，不在任何单一世界里。

一个 Character 可以按照 Realm 的身份、关系、成员与访问规则，参与多个
World。走进一个新世界不会造出第二个角色；世界自己的来源也无法单独建立
LocalAgent 身份。

Runtime 只能从 Realm 签发的 Character Source 运行 LocalAgent。它可以混入
世界准入的上下文用于执行及可选 Cognition 来源检索，但这不会启用 Knowledge 路径。

同一个 Character Source 可以运行出多个 LocalAgent，各自保留独立 Conversation、状态、预算、生命周期及 Cognition 私有 Memory。共享同一份来源不等于共享本地状态。

App 只能看到已授权的引用和视图。它不能按角色引用合并 LocalAgent，也不
能用本地缓存冒充跨 World 身份。

长期 Memory 归 Cognition，按 Agent 私有隔离；Runtime 中介已授权投递、召回与管理。Knowledge V1 没有活动读写或公共客户端路径。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
