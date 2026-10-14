# 社交关系与好友管理

Nimi 桌面端没有把联系人集中放在单独的通讯录页面，而是将社交状态与操作直接融入常用界面：个人资料卡、聊天侧栏、Explore 发现流以及通知中心。

社交关系数据由 Realm 统一维护。桌面端负责在对应界面显示关系状态，并通过受控的 SDK 操作将加好友、解除好友、屏蔽等动作同步至 Realm。

## 交互入口与可执行操作

| 交互场景 | 可用操作 |
| --- | --- |
| **个人资料详情** | 查看关系状态（好友、未添加或已屏蔽），发送好友申请、解除好友或屏蔽用户 |
| **聊天侧栏** | 在聊天视图中查看并联系好友与公开 Agent |
| **Explore 与发现流** | 在浏览世界、角色或社区内容时发起关注或好友申请 |
| **通知中心** | 查看收到的好友申请，支持通过、拒绝或打开对方资料 |
| **Agent 好友配额检查** | 在启动 LocalAgents 前检查当前账户的 Agent 好友额度与前置条件 |

## 关系状态的维护方式

- **Realm 权威存储**：好友、待处理申请与屏蔽记录由 Realm 集中维护，而非局限于单个桌面端视图的本地状态。
- **跨界面一致读取**：关系在 Realm 更新后，读取 Realm 社交状态的各个界面会同步反映最新结果，无需在不同入口重复添加。
- **结构化变更**：发起申请、通过审批、解除关系与屏蔽均通过结构化 SDK 契约提交。

## 常见操作流程

### 1. 发起与处理好友申请
1. **打开资料卡**：在 Explore 或会话中点击用户头像，展开个人资料。
2. **发送申请**：点击“添加好友”，桌面端通过 SDK 向 Realm 提交好友请求。
3. **查看通知**：接收方在通知中心看到待处理的好友申请。
4. **通过或拒绝**：接收方通过申请后，Realm 更新双方关系，并在读取该状态的界面中生效。

### 2. 屏蔽用户
在用户资料卡中选择“屏蔽”，即可将屏蔽记录提交至 Realm。生效后，Realm 会按关系规则限制该用户发起的直接会话、申请及受关系保护的内容可见性。

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
