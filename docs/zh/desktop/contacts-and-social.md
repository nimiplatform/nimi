# 关系与社交

桌面端已经没有独立的联系人页。关系与社交行为只出现在用户正在操作的上下文中：个人资料详情、聊天关系栏、Explore 发现、Home 资料卡以及通知。

Realm 持有社交图真相。桌面端读取关系投影、渲染上下文动作，并通过已准入的 Realm/SDK 路径提交强类型变更。

## 桌面端投影什么

| 表面 | 行为 |
| --- | --- |
| 资料详情 | 显示关系状态、发起好友请求、移除好友、屏蔽用户 |
| 聊天关系栏 | 在 Chat 上下文中展示可用的人与 Agent |
| Explore / Home 发现 | 在发现资料时提供上下文加好友动作 |
| 通知 | 接受、拒绝或查看收到的好友请求 |
| AgentFriend gating | 执行 Agent 好友配额与 LocalAgent 启动前置条件 |

这里没有 Contacts 主导航、懒加载路由、页面外壳或独立侧边栏。那些形态已经退役，产品概念收敛为关系、资料与当前任务上下文。

## 好友关系是规范化的平台真相

Nimi 的好友关系是平台规范化真相。一旦准入，它不属于某个世界、某次会话或某个应用。Alice 与 Bob 同时访问的任何世界、任何 Nimi 应用都会看到同一段关系。

| 维度 | 取值 |
| --- | --- |
| 存储 | Realm `R-SOC-*` |
| 形态 | 有序对唯一性图 |
| 跨世界可见 | 是 |
| 跨应用可见 | 是 |
| 修改 | 经由准入的 Realm 契约 |

桌面端不会把关系状态当作自己的本地缓存。它只投影 Realm 真相；投影或变更前置条件缺失时必须失败关闭。

## 场景：发送好友请求

你在 Explore 或 Home 中发现一个资料，并发送好友请求。

1. **打开资料上下文**。资料详情表面展示当前关系投影。
2. **提交请求**。桌面端通过已准入的 Realm/SDK 路径提交强类型好友请求。
3. **Realm 准入**。请求被记录，对方在通知上下文中看到。
4. **对方接受**。Realm 将好友关系标记为 `active`。
5. **处处可见**。关系成为平台真相，并出现在其它已准入上下文中。

这个流程不经过联系人页。

## 场景：屏蔽某位用户

你在资料上下文中屏蔽一位用户。

1. **屏蔽**。上下文资料表面提交屏蔽请求。
2. **Realm 准入**。社交图记录这次屏蔽。
3. **跨上下文生效**。Chat 与其它依赖关系状态的前置条件拒绝继续直接交互。
4. **审计血缘**。这次变更带着准入来源被记录。

屏蔽是一份社交真相，不是桌面端私有设置。

## 来源依据

- [`.nimi/spec/desktop/kernel/relationship-profile-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/relationship-profile-surface-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
