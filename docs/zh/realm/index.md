# Realm 核心服务与世界底座

Realm 是 Nimi 的服务端业务层，负责维护跨应用的账户体系、社交关系、人与人即时通讯、世界与角色设定源（`WorldCore`、`WorldCharacter`、`PersonaCharacter`）以及创作者经济记录。

在 Nimi 的整体架构中，各层职责如下：
- **Runtime**：负责本地与云端 AI 模型推理、`LocalAgent` 对话执行与 Cognition 长期记忆的访问协调，并集中托管 Realm 访问凭据与远端实时连接；
- **Realm**：维护共享账户、社交图谱、人与人实时通道（`DirectChat`、typing、inbox、`Presence`）、世界与角色设定数据（`WorldCore`、`WorldCharacter`、`PersonaCharacter`、`WorldEntity`、`WorldRelationship`）及创作者经济服务；
- **SDK**：提供类型化客户端绑定（如 `client.realm.worldCore` 与 `client.realm.personaCharacter`），让应用调用经 Runtime 准入的能力；
- **Desktop & Web**：Desktop 承载 Nimi Home 与受监管的 App；Web 提供官网与浏览器账号体验。

## 核心章节导览

### 权威状态与数据抽象
- [Realm 权威边界](/zh/realm/truth)：了解 Runtime、宿主会话与服务端 Realm 的职责划分与访问边界；
- [状态投影机制（Projection）](/zh/realm/projection)：应用如何通过已准入的 SDK 接口读取结构化视图；
- [世界状态（World State）](/zh/realm/world-state)：规划中的持久化共享世界状态契约与提交信封设计参考；
- [世界历史（World History）](/zh/realm/world-history)：规划中的仅追加世界历史契约与订正记录设计参考。

### 核心领域契约
- [社交与即时通讯](/zh/realm/chat)：经由 Runtime 中介的人与人 `DirectChat`、输入状态（typing）、收件箱（inbox）与在线状态（`Presence`）；
- [社交图谱与经济系统](/zh/realm/social-and-economy)：共享好友关系、关注体系与价值流转；
- [数字资产与世界绑定](/zh/realm/asset-and-binding)：创作者资产与世界资源的关联管理；
- [跨世界漫游（Transit）](/zh/realm/transit)：围绕系统主世界 OASIS 展开的跨世界连续性协议设计。

### 创作者经济与应用互联
- [创作者经济模型](/zh/realm/creator-economy)：数字内容变现与收益分配机制；
- [创作者收益结算](/zh/realm/creator-payouts)：收益记录与结算流程；
- [应用互联范式](/zh/realm/app-interconnect)：应用如何通过受保护宿主会话、清单 `realm.data` 声明与 Runtime 准入访问 Realm 数据。

## 应用如何与 Realm 协作？

并非所有应用数据都会自动同步到 Realm。厘清 Realm 与 Runtime 的边界有助于合理设计应用架构：

- **受控访问与凭据托管**：应用不直接持有 Realm Bearer 凭据、原生 HTTP 客户端或底层连接。访问 Realm 必须处于受保护宿主会话中，在应用清单声明 `realm.data` 并通过 Runtime 准入，最终由 Realm 校验资源级授权。
- **世界与角色设定操作**：普通应用通过既有宿主绑定 `client.realm.worldCore` 与 `client.realm.personaCharacter` 执行 Runtime 显式接纳的固定类型操作（涵盖 `WorldCore`、`WorldCharacter`、`WorldEntity` 及 `WorldRelationship` 各自支持的操作，其中世界关系对 App 仅开放读取；新建世界需由 Realm 管理员显式授予账号创建资格）。
- **实时通道与本地智能体记忆分工**：当前向应用准入的实时能力限于人与人的 `DirectChat`、typing、inbox 与 `Presence`。`LocalAgent` 对话归属 Runtime，单智能体长期记忆由 `Cognition` 经 Runtime 中介管理；`World State` / `World History` 仍是规划契约，未提供公开读写接口；通用世界事件广播也尚未开放。

## 相关文档

- [统一术语表](/zh/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
