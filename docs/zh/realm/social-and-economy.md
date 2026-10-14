# 社交图谱与经济系统（Social & Economy）

Realm 在账号层提供两项基础能力：**人与人如何建立连接**（Realm Social），以及**数字价值如何记录与归因**（Realm Economy）。两套系统根据各自的业务生命周期采用不同的数据模型：社交关系采用可状态流转的账号对模型，而资金与币种流水采用仅追加（Append-Only）的交易记录模型。

## 账号社交图谱（Realm Social）

Realm Social 负责管理真人账号之间的社交关系，当前权威模型由好友关系（`Friendship`）与独立的账号拉黑（`AccountBlock`）组成。

- **唯一有序账号对与状态流转**：每条 `Friendship` 记录使用唯一确定排序的账号对表示，支持好友申请、状态变更与解除关系，而非仅追加的事件账本。
- **跨世界延续与授权边界**：好友关系绑定在账号层，用户切换世界时无需重复添加好友。但账号层存在好友关系并不意味着所有应用都能全量读取好友信息，实际的可见性与可执行操作仍取决于当前上下文的权限校验。
- **清晰的职责边界**：
  - **即时通讯联动**：人与人之间的私聊会检查适用的好友与拉黑前提条件，而具体的会话与消息流由独立的 [Realm Chat](/zh/realm/chat) 托管。
  - **角色与本地 Agent 隔离**：Realm Social 仅维护真人账号之间的关系，不持有 Character 或 Persona 关系，也不负责 LocalAgent 的创建、对话或长期记忆。

## 平台经济系统（Realm Economy）

Realm Economy 拥有可审计的订阅管理、币种交易以及收益归因与分成语义。叙事交互与本地 AI 推理的算力开销独立核算，不与 Realm 币种及虚拟资产余额混同。

### 账号币种交易（CurrencyTransaction）

涉及账户余额变动的流水通过仅追加的 `CurrencyTransaction` 事件记录，以避免静默改账并保障审计可追溯性。具体的字段结构与事件枚举以当前 OpenAPI 与 Prisma 定义为准。

### 创作者收益：从来源归因到提现的四个阶段

面向角色与内容创作者，平台将“收益试算”与“实际入账”严格解耦，划分为四个概念阶段：

1. **来源归因（当前可用）**：`RevenueShareService` 支持经过鉴权的强类型 `CharacterSourceRefV3` 来源查询，用于识别创作内容的归属与贡献来源。
2. **分成预览（当前可用）**：基于归因结果，`RevenueShareService` 提供确定性的收益分成预览。预览仅作只读计算，不会改变任何账户余额。
3. **正式账本结算**：将分成结果转化为实际的余额变动，必须通过另行获准、幂等且原子的账本事务完成。计算出的分成比例或预览结果本身不代表资金已到账或已划拨。
4. **创作者提现与收益工作台（平台方向）**：创作者提现、外部支付渠道打款以及桌面端收益工作台属于平台演进方向，并非当前 Desktop 已内置的功能或公开 App API。

## 应用访问与权限校验

普通 Nimi App 仅能通过受保护的 `client.realm` 调用显式准入的操作；由 Runtime 保管凭据，并由 Realm 校验资源级权限。拥有 `realm.data` 等基础权限并不等同于获得通用社交或经济接口的全量授权。

## 相关文档

- [创作者经济与收益结算](/zh/realm/creator-economy)
- [Realm 即时通讯体系](/zh/realm/chat)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
