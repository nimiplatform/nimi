# Realm

Realm 是 Nimi 生态的服务端。世界共享的真相都放在这里：账号与身份、朋友关系、聊天、经济、世界，以及世界里的角色。Nimi 不在本地重新实现这些规则，而是通过 SDK 连接 Realm，按 Realm 的规则来。

分工很直白：Runtime 执行 AI 任务；SDK 为 App 提供访问 Realm 的通道；桌面端和网页端负责呈现体验。世界的共享真相始终保存在 Realm 一侧，Nimi 的代码只处理从 SDK 拿到的强类型视图。

## 本节包含的内容

Realm consumer 入口：

- [Realm 真相边界](/zh/realm/truth)：Nimi 消费外部 Realm truth 时拥有什么、不拥有什么。
- [Realm 消费者投影](/zh/realm/projection)：Nimi consumer 如何通过 SDK boundary 接收 Realm API output。
- [世界状态](/zh/realm/world-state)：世界的当前状态是什么、怎么变。
- [世界历史](/zh/realm/world-history)：一个世界里发生过的事，只追加不改写。

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

Nimi App 可以出现在很多地方：桌面端、网页端、Avatar、创作者工具，或者为某个世界专门写的扩展应用。每个地方的界面可以不一样，但谁也不能在本地编造共享真相，大家都通过 SDK 生成的客户端和强类型封装来读 Realm。

如果 Realm 数据取不到、验证不了、解不开，或者和 App 上次看到的不一致，App 必须如实告诉用户——给出一个明确的"不可用"或错误状态，绝不能假装读取成功。

## 读者场景：App 读取 Realm 数据

1. **App 请求 Realm 数据。** App 通过 SDK Realm facade 发起调用。
2. **SDK 使用 generated Realm core。** 请求形状来自配置的外部 Realm OpenAPI 输入。
3. **Realm 返回结果。** 外部 Realm authority 拥有 server/domain truth。
4. **Nimi 投影结果。** Runtime、Desktop、Web 或 App code 可以缓存或呈现输出，但不能让它成为 canonical truth。
5. **失败保持类型化。** 缺少 token、endpoint、API drift 或 Realm output 不可用时必须 fail closed，不能在本地合成成功。

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
