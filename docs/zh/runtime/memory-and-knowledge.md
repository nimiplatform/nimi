# Memory 与 Knowledge

Runtime 持有每个 LocalAgent 的运行态 Memory 与 Knowledge。它决定哪些已授权
输入可以被准入、召回、保留、查询、用于执行，以及投影给 consumer。

## Realm source truth 与 Runtime 运行态真相

Realm 持有 PersonaCharacter、WorldCharacter、Character Source、World Source、
canonical World data 及其访问规则。Runtime 可以把已准入的 Character Source
作为 LocalAgent 物化的身份来源，也可以在执行中使用已准入的 World Source
上下文。

这些 source context 不会把 Realm ownership 转移给 Runtime。反过来，Runtime
Memory 或 Knowledge 也不会自动成为 canonical Realm World state 或 history。

## LocalAgent 隔离

从同一 Character Source 物化的多个 LocalAgent 拥有彼此独立的运行态 Memory
与 Knowledge。共享 Character source 不会创建隐式共享的可变状态。

Conversation transcript 与 UI history 都是投影，不能代替 Memory 或 Knowledge。
Consumer 不能通过回放 cached message 重建 Runtime 真相。

## 已授权访问

每次 Memory 或 Knowledge 操作前，Runtime 都从 active session 推导 account、
App identity、authorization、目标 LocalAgent 或已准入 scope，以及 operation。

已授权 consumer 只能收到针对该 account、App、LocalAgent、scope 与 operation
获准公开的内容和 metadata。内部 prompt、Provider 细节、Credential、source
material、proof 及无关 LocalAgent 数据保持私有。

如果操作处于 blocked、unavailable、pending 或 failed，Runtime 返回强类型
结果，但不改变 Conversation 或其他 owner 的真相。

## 可选 Bridge

独立 cognition 实现可以位于有限的公共 bridge 后方，但不会接管 Runtime
LocalAgent Memory、Knowledge、Conversation、authorization、lifecycle 或
execution 真相。它缺失时，不会阻塞当前 Runtime、SDK、Nimi Home 或 App 路径。

## 来源依据

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
