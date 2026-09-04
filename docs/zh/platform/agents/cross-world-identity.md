# 跨 World 身份

角色在每个世界里都是它自己。这种连续性存在于 Realm 的 Character 身份
里，不在任何单一世界里。

一个 Character 可以按照 Realm 的身份、关系、成员与访问规则，参与多个
World。走进一个新世界不会造出第二个角色；世界自己的来源也无法单独建立
LocalAgent 身份。

Runtime 只能从 Realm 签发的 Character Source 运行 LocalAgent。它可以混入
世界共享出来的上下文，用于执行、Memory 和 Knowledge，但得到的仍是一个由
Runtime 运行的本地执行实体。

同一个 Character Source 可以运行出多个 LocalAgent。除非有显式约定，它们
各自的运行态 Memory、Knowledge、Conversation、状态、预算和生命周期彼此
独立。共享同一份来源，不等于共享活的本地状态。

App 只能看到已授权的引用和视图。它不能按角色引用合并 LocalAgent，也不
能用本地缓存冒充跨 World 身份。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
