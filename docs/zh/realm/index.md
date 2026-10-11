# Realm 核心服务与世界底座

Realm 是 Nimi 互联网络的服务端核心，为所有数字世界提供持久化的权威状态服务。全平台通用的账户体系、社交网络、世界状态流转、创作者经济以及跨世界漫游（Transit），均由 Realm 提供统一的单一可信源。

在 Nimi 的宏观分工中：
- **Runtime**：负责本地与云端 AI 模型推理、智能体执行与私有记忆中介；
- **Realm**：维护全网共享的世界状态、实体关系与创作者资产网络；
- **SDK**：为应用开发者提供连接 Runtime 与 Realm 的标准化客户端；
- **Desktop & Web**：为普通用户提供直观沉浸的交互界面。

## 核心章节导览

### 权威状态与数据抽象
- [Realm 权威边界](/zh/realm/truth)：了解 Nimi 客户端与服务端 Realm 的权责划分；
- [状态投影机制（Projection）](/zh/realm/projection)：客户端如何通过 SDK 消费只读状态视图；
- [世界状态（World State）](/zh/realm/world-state)：世界当前快照的存储与原子提交机制；
- [世界历史（World History）](/zh/realm/world-history)：基于仅追加日志的不可变事件记录与审计复现。

### 核心领域契约
- [社交与即时通讯](/zh/realm/chat)：跨世界好友聊天、会话流转与消息投递；
- [社交图谱与经济系统](/zh/realm/social-and-economy)：全局好友网络、关注体系与价值流转；
- [数字资产与世界绑定](/zh/realm/asset-and-binding)：创作者资产在世界场景中的挂载与归属；
- [跨世界漫游（Transit）](/zh/realm/transit)：基于 OASIS 枢纽的跨世界穿梭与身份连续性。

### 创作者经济与应用互联
- [创作者经济模型](/zh/realm/creator-economy)：数字内容发布、版权收益与价值分配；
- [创作者收益结算](/zh/realm/creator-payouts)：收益账本、提现与结算安全；
- [应用互联范式](/zh/realm/app-interconnect)：第三方应用接入并消费 Realm 数据的最佳实践。

## 为什么应用依赖 Realm？

数字世界并非一个个彼此孤立的单机孤岛。用户在桌面端、网页端或 VR 设备中参与体验时，他们的数字身份、好友网络与随身资产应当无缝跨端漫游。Realm 保证了全网状态的高度一致性，避免了本地状态不一致或数据分裂。

## 相关文档

- [统一术语表](/zh/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
