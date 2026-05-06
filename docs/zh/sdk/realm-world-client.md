# Realm 与世界 Client

SDK 里访问 Realm 与世界讲的是受控组合。App 需要读和用世界真相，但它不能变成第二份 Realm 权威。

这页是 `sdk/realm` 与 `sdk/world` 的读者视角。权威在 SDK kernel 的 `S-REALM-*` 与 `S-WORLD-*` 下，以及 Realm kernel 里。

## Realm 访问怎么走

Realm 拥有语义真相、世界状态、世界历史、聊天，及相关域合同。SDK 可以暴露公开 facade 给 App 用，但它**不改变 Realm 真相住在哪里**。

对读者而言：

- Realm client 让 App 读已被准入为公开的世界真相面。
- 它**不**暴露后端、dashboard、创作侧的权威。
- 它**不**让 App 以「不走准入 Realm 合同就改真相」的方式回写 Realm。

## 世界组合

世界 API 把 Realm 真相跟 Runtime 撑的生成或物化流组合起来。这种组合对 App 有用，因为一段世界体验通常两边都需要：

- 对世界当前状态与历史的稳定读（Realm），
- 在那个状态里动手的生成式或交互式 AI 能力（Runtime）。

组合合同让所有者线保持可见。Realm 仍然是真相所有者。Runtime 仍然是执行所有者。世界 client 是它们相遇的地方，不是所有权变模糊的地方。

## 阅读场景：先读世界状态，再让 Agent 动手

App 想显示世界视图，然后请 Agent 在里面动手：

1. App 用 `sdk/world` 读类型化世界状态视图。Realm 合同（truth、world-state、world-history）被投到稳定形状上。
2. App 用 `sdk/runtime` 在 runtime 拥有的 Agent 参与下发起 Agent 动作。Runtime 合同治理执行。
3. 动作对世界真相的影响（如有）通过准入 Realm 合同落下，不是 App 自己重新声明世界真相。
4. App 通过 `sdk/world` 重新读世界状态以反映新真相。它**不**维护一份会跟 Realm 漂移的私有镜像。

这种切分的意义在于：App 是两个权威的消费者，不是第三个权威。

## 阅读场景：读世界历史

App 要显示某个世界的历史 — 过去的关系、过去的事件、过去的转换：

1. 世界历史归 Realm 拥有，受 world-history 合同治理。
2. SDK 投出已被准入为公开的 history 表面。
3. App 读这个表面并渲染。App **不**自己发明权威 history 列表。

如果渲染出的 history 错了，修复点在 Realm 或被读出的表面，不在 App 里盖住 Realm 输出。

## 活跃面 vs 已定义面

某些世界组合面是活跃且稳定的；某些是已定义但尚未完整公开产品。SDK surface 合同区分两者。

对读者而言，实操规则是：依赖一个方法之前先读 surface 合同；没提到的方法就当它不在合同里。

## 来源

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
