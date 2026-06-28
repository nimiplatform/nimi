# Transit

Transit 是参与者在世界之间移动时使用的**单跳连续性协议**。创作者世界之间不能直接对接 transit，每一次穿越都要经过 OASIS。这不是物流上的繁琐设计，是一份连续性保证。

## 单跳经过 OASIS

| 属性 | 值 |
| --- | --- |
| 拓扑 | hub-and-spoke；OASIS 是 hub |
| 直接 creator-to-creator transit | 不允许 |
| Transit 路径 | 源世界 → OASIS → 目标世界 |
| 身份 | 整段 transit 中保持 |
| 真相变更 | transit 过程中没有 |
| 审计 | 每一跳都入账 |

为什么是 hub-and-spoke 而不是点对点？两条设计性质依赖它：

| 性质 | hub-and-spoke 如何支撑 |
| --- | --- |
| 跨世界身份连续 | OASIS 是规范锚；身份在每一跳之间锚住不动 |
| 默认归位点 | 目标世界不可达时，参与者回到 OASIS |
| 不可替换性 | OASIS 是规范真相的一部分，没有创作者世界能取代它 |
| 边界化的对接策略 | N 条 transit 策略（每个世界 ↔ OASIS）而不是 N×N |

## 身份保持

Transit 不会改写参与者的规范身份。变化的是**上下文**——他们处在哪个世界。不变的是**身份**——他们是谁。

| transit 中保持不变 | transit 中会变 |
| --- | --- |
| 身份（规范层） | 当前世界上下文 |
| 社交关系 | 世界内部的本地社交规则 |
| 经济关系 | 世界内部的经济语义 |
| 记忆（按记忆库范围） | 世界共享记忆范围 |
| Avatar 呈现配置 | 目标世界对载体的接受策略 |

`AGENT_CORE` 与 `AGENT_DYADIC` 范围的记忆全程随行；`WORLD_SHARED` 范围的记忆留在它所属的世界。

## 场景：在两个世界之间移动

某用户要把角色从世界 A 移到世界 B。

1. **发起 transit**。用户启动迁移，准入的 transit 基础协议生效。
2. **hub-and-spoke 路由**。Realm 把这次 transit 路由为：世界 A → OASIS → 世界 B。
3. **在 OASIS 中**。身份锚定在规范真相上；参与者位于 hub。
4. **进入世界 B**。Realm 按世界 B 的准入策略放行。
5. **抵达世界 B**。参与者已在世界 B，规范身份、社交图、钱包均保持。

整段移动里，**身份不变**。参与者不是世界 B 里的"新实体"，而是同一个规范实体。

## 场景：目标世界不可达

某用户发起 transit，但目标世界离线。

1. **发起**。用户开始向目标世界 transit。
2. **Realm 检查**。目标世界处于 `unavailable`（创作者下线，或在维护）。
3. **默认归位**。参与者按默认回到 OASIS。不会被卡死。
4. **用户选择**。在 OASIS，用户可以挑另一个世界进入，也可以等目标世界恢复。

如果没有 OASIS 这个默认归位点，"穿越中世界宕机"就是一个要单独处理的错误。有了 OASIS，它是一次平稳的回退。

## 场景：被禁止的直连 transit

某创作者应用想直接把参与者从世界 A 送到世界 B，绕开 OASIS。

1. **提交 transit**。应用尝试直连。
2. **Realm 校验**。直连的 creator-to-creator transit 不准入。
3. **拒收**。fail-closed；强类型错误。
4. **没有捷径**。应用没法构造"绕路方案"，协议要求 OASIS 在路径上。

正因为禁止了直连，连续性保证才是真实的。创作者无权放弃 hub。

## 跨域触点

Transit 同时触及多条基础协议。一次 transit 必须满足：

| 基础协议 | 要求 |
| --- | --- |
| Transit | 该次穿越被准入 |
| Social | 参与者的社交关系在目标世界被准入 |
| Economy | 经济关系可转移 / 可被接受 |
| Context | 情境语义在两个世界之间保持 |
| Presence | 在目标世界产生新的存在记录 |

平台的六项基础协议彼此约束。Transit 是"多条基础协议在同一动作上汇合"的典型例子。

## 各世界的 transit 策略

每个世界都声明自己准入的 transit 策略：哪些参与者可以进入、需要哪些社交 / 经济 / 上下文前置、离开时本地状态如何处理。

| 元素 | 拥有方 |
| --- | --- |
| 源世界的 transit 策略 | 源世界的创作者 |
| OASIS hub 策略 | 平台 |
| 目标世界的准入策略 | 目标世界的创作者 |

一次 transit 必须同时满足三层策略。任意一层失败都 fail-closed。

## Transit 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 改写规范身份 | 身份是 Realm 规范真相 |
| 改写规范经济 | 经济关系是规范层数据 |
| 跳过 OASIS | hub-and-spoke 是拓扑；没有捷径 |
| 允许 N×N 点对点 transit | 设计上禁止 |

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
