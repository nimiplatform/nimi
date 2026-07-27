# 跨 World 身份

跨 World 身份属于 Realm 的 Character 真相。

一个 Character 可以依据 Realm 持有的身份、关系、成员与访问规则参与多个
World。World 专属上下文不会创建第二个 Character，单独的 World Source 也
不能建立 LocalAgent 身份。

Runtime 只能从 Realm 签发的 Character Source 物化 LocalAgent。它可以组合
已准入的 World Source 上下文用于执行、Memory 与 Knowledge，但得到的
LocalAgent 仍是 Runtime 持有的本地执行实体。

同一 Character Source 可以物化多个 LocalAgent。除非存在显式 owner contract，
它们的运行态 Memory、Knowledge、Conversation、状态、预算与生命周期彼此
独立；共享 source 不等于共享可变本地状态。

App 只能看到已授权的引用与投影。它不能根据 Character 引用合并 LocalAgent，
也不能把本地 cache 提升为跨 World 身份真相。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
