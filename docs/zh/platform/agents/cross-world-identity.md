# 跨世界身份连续性（Cross-World Identity）

角色在任何数字世界中始终保持一致的自我认同。这种身份连续性建立在 Realm 的 Character 身份层之上，而非受限于任何单个具体的虚拟世界。具体的对话流与长期记忆则由对应 LocalAgent 的 Runtime 与 Cognition 生命周期独立维护。

一个 Character 实体可以按照 Realm 统筹的身份规范、社交关系、世界成员准入与访问策略，合规参与多个不同的数字世界。角色漫游进入一个新世界，绝不会派生出第二个新角色；单个世界的局部配置也无法绕过系统独立建立具有全局意义的 LocalAgent 身份。

Runtime 仅基于 Realm 签发的官方 Character Source 实例化 LocalAgent。在执行过程中，智能体可按需加载经授权的世界情境上下文与 Cognition 记忆检索；但这不会开启未受控的私有知识库旁路。

同一个 Character Source 可以由 Runtime 在不同场景下实例化出独立的 LocalAgent 运行态。各个实例独立维护其对话流、执行状态机、Token 预算、进程生命周期以及专属于该智能体的 Cognition 长期记忆。共享同一份基础角色设定，并不等同于共享运行时的瞬时上下文与执行状态。

第三方应用仅能访问其已获授权的角色引用与只读数据视图，严禁私自将多个 LocalAgent 的状态进行隐式拼接，更不能利用前端本地缓存伪造全局跨世界身份。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
