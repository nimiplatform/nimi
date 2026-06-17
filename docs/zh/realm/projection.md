# 已废止的 Projection 指针

Realm 不再把 projection package 当作当前世界/persona 消费权威。App 和 Runtime
消费的是已准入的 core/source 形态：

- 世界读取暴露 `WorldCore` 和已准入的世界聚合；
- 角色读取暴露 `WorldCharacterCore`；
- persona 读取暴露 `RealmPersona`；
- Runtime 通过 `RuntimeSourceSnapshot` 按值物化 LocalAgent。

Projection 不是写入路径，不是 prompt 构建器，也不是平行真相。如果下游需要专用
视图，它必须从 core 对象按请求派生，不能替代 core 对象。
