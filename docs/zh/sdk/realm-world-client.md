# Realm 与 World Client

SDK 里访问 Realm 与世界，本质是受控组合。App 需要读取并使用世界真值，但不应当成为第二份 Realm 权威。

本页是 `sdk/realm` 与 `sdk/world` 的读者视角。权威落在 SDK 内核 `S-REALM-*` 与 `S-WORLD-*`，以及 Realm 内核里。

## Realm 访问怎么工作

Realm 持有语义真值、世界状态、世界历史、聊天，以及相关领域契约。SDK 可以暴露一个公开门面供 App 使用，但不会改变 Realm 真值的归属。

对读者而言：

- realm client 让 App 读取已准入为公开的世界真值面。
- 不暴露后端、控制台或创作者侧的权威。
- 不允许 App 通过 Realm 准入契约之外的方式回写真值。

## 世界组合

世界 API 把 Realm 真值与 Runtime 支撑的生成 / 物化流组合在一起。这种组合对 App 有用，因为一个世界体验通常需要两件事：

- 一份关于世界当前状态与历史的稳定读取（Realm）；
- 一项可以在该状态内行动的生成式或交互式 AI 能力（Runtime）。

组合契约让归属线一直可见。Realm 仍是真值持有者；Runtime 仍是执行持有者。world client 是它们交汇的地方，而不是归属变模糊的地方。

## 场景：先读世界状态再让 Agent 行动

某个 App 想展示世界视图，再让 Agent 在其中行动：

1. App 用 `sdk/world` 读取强类型世界状态视图。Realm 契约（truth、world-state、world-history）转换为稳定形状。
2. App 用 `sdk/runtime` 在 Runtime 持有的 Agent 参与契约下发起 Agent 行动。执行由 Runtime 契约管控。
3. 行动若影响世界真值，影响通过准入的 Realm 契约写回，而不是 App 自行重述世界真值。
4. App 通过 `sdk/world` 重新读取世界状态以反映新的真值。它不维护一份与 Realm 偏离的私有镜像。

拆分的意义在于：App 是两个权威的使用者，而不是第三个权威。

## 场景：读取世界历史

某个 App 要显示一个世界的历史——过往关系、过往事件、过往迁移：

1. 世界历史归 Realm 持有，由 world-history 契约管控。
2. SDK 转换出已准入为公开的历史面。
3. App 读取该面并渲染。App 不会自创规范历史列表。

如果渲染出来的历史有错，修复点在 Realm 或公开的 surface 转换层，不在用 App 逻辑去覆盖 Realm 输出。

## 活动 surface 与已定义 surface

部分世界组合 surface 是活动且稳定的；部分是已定义但尚未成为完整公开产品。SDK 的 surface 契约区分这两类。

读者只需记住：依赖某个方法之前，先看它在 surface 契约里有没有；没有提到的方法不属于契约。

## 来源依据

- [`.nimi/spec/sdk/realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/realm.md)
- [`.nimi/spec/sdk/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/world.md)
- [`.nimi/spec/sdk/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/realm-contract.md)
- [`.nimi/spec/sdk/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
