# 术语表

## 身份与执行

**Character。** 有持久身份的长期参与者，由 Realm 保存。PersonaCharacter
和 WorldCharacter 是 Character 的形态。

**Character Source。** Realm 签发的角色描述，Runtime 据此运行出
LocalAgent。

**World Source。** Realm 保存的世界上下文描述。它可以为 LocalAgent 提供
信息，但单靠它自己创建不出 LocalAgent。

**LocalAgent。** Runtime 把角色在本地运行起来的实例，范围限定在它为之服
务的用户。它自己不持有 Realm 身份或世界事实。

**Conversation anchor。** Runtime 给一段 LocalAgent 对话起的显式名字。一
个 LocalAgent 可以有多段对话。

**运行态 Memory。** LocalAgent 运行时记住的东西：怎么回忆、保留多久、如
何隔离，以及 Runtime 对外提供的已授权视图。

**运行态 Knowledge。** LocalAgent 知道的东西：怎么摄入、怎么检索、如何
隔离、生命周期怎么管，以及 Runtime 对外提供的已授权视图。

## 产品 Surface

**SDK。** App 与 Runtime、Realm 打交道的强类型公共入口。

**Kit。** 共享 UI 与宿主组合，产品界面真正需要时才加入，不是预置各种能
力的目录。

**Nimi Home。** 产品的入口，也是当前桌面端的宿主界面。负责承载体验，并
不等于它保管 Realm 或 Runtime。

**Avatar。** 角色的具身外壳：按 Runtime 发来的强类型呈现内容渲染角色，
并管理自己 renderer 本地的行为。

**Simulator。** 给选定 App 模块用的开发与验证工具，不是当前的产品平
台，也不是产品宿主。

## 访问与失败

**Session-derived access。** Runtime 根据你当前的登录会话判断账号、
App 身份、授权、目标 LocalAgent 或范围，以及操作。

**Typed unavailable。** 一个明确的答复，表示某个可选或不适用的能力当前
不可用。这是诚实的「没有」，不是假装的「成功」。

**Projection。** 由数据保管方提供的一份有限视图。看到视图，不等于拿到
所有权。

**Owner。** 对某项产品事实及其修改规则负责的部分。代码位置、包名、文
档、缓存或宿主角色，都不会产生所有权。

## 六项协议基础

**State。** 某个东西此刻的状态，由保管它的部分控制。

**Event。** 一条强类型通知，表示有事发生，由保管方发出。

**Intent。** 对某个结果的强类型请求。提出请求不等于获得授权。

**Action。** 由负责方接受并执行的操作。

**Audit。** 由负责方保存的安全或产品相关活动记录。

**Permission。** 负责方作出的决定，授权一次有范围限定的操作。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
