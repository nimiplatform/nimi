# Realm

Realm 是外部 server/domain authority，负责世界真相。在本仓库中，Nimi 通过 SDK Realm boundary 消费 Realm，而不是在本地重新定义 Realm server rules。

Runtime 负责执行 AI work。SDK 为 App 提供访问边界。Desktop 与 Web 负责呈现体验。共享世界真相仍锚定于外部 Realm authority；Nimi-owned code 只处理 typed consumer projections。

## 本节包含的内容

Realm consumer 入口：

- [Realm 真相边界](/zh/realm/truth)：Nimi 消费外部 Realm truth 时拥有什么、不拥有什么。
- [Realm 消费者投影](/zh/realm/projection)：Nimi consumer 如何通过 SDK boundary 接收 Realm API output。
- [世界状态](/zh/realm/world-state)：当前世界状态的 reader-facing context。
- [世界历史](/zh/realm/world-history)：append-only world history 的 reader-facing context。

Domain reading map：

- [聊天](/zh/realm/chat)：conversation 如何参与 Realm-backed meaning。
- [社交与经济](/zh/realm/social-and-economy)：从 Realm 消费的 relationship 与 value-flow concepts。
- [资产与绑定](/zh/realm/asset-and-binding)：App reader 如何讨论 world contents 与 attachments。
- [Transit](/zh/realm/transit)：跨世界移动的 continuity concepts。

创作者与 App surfaces：

- [创作者经济](/zh/realm/creator-economy)：creator economy 与 settlement concepts。
- [应用互联](/zh/realm/app-interconnect)：app-side Realm consumption patterns。

关于 state 与 history 的对照，见 [平台 → 世界 → 真相、状态与历史](/zh/platform/worlds/state-vs-history)。遇到不熟悉的术语，可查阅跨领域通用的[术语表](/zh/reference/glossary)。

## 为什么 Nimi App 需要 Realm

Nimi App 可以运行在多个 surface 中：desktop、web、avatar、creator tools 以及 world-specific extension apps。这些 surface 可以呈现不同视图，但不能在本地发明 Realm truth。它们通过 generated SDK clients 和 typed facades 消费 Realm。

如果 Realm output 无法 fetch、authenticate、decode，或无法与 local projection state reconcile，Nimi consumer 必须暴露 typed unavailable/error state，不能合成 Realm success。

## 读者场景：App 读取 Realm 数据

1. **App 请求 Realm 数据。** App 通过 SDK Realm facade 发起调用。
2. **SDK 使用 generated Realm core。** 请求形状来自配置的外部 Realm OpenAPI 输入。
3. **Realm 返回结果。** 外部 Realm authority 拥有 server/domain truth。
4. **Nimi 投影结果。** Runtime、Desktop、Web 或 App code 可以缓存或呈现输出，但不能让它成为 canonical truth。
5. **失败保持类型化。** 缺少 token、endpoint、API drift 或 Realm output 不可用时必须 fail closed，不能在本地合成成功。

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
