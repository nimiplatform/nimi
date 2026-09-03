# Chat

Realm Chat 是两个人之间私聊存放的地方。聊天线程、消息、成员和已读状态都只有一份，存在 Realm 里——不在你的桌面端上，也不属于某一次登录会话。每个界面读的都是这同一条线程。

## 聊天载体

Realm Chat 只准入一种载体：

| 载体 | 用途 |
| --- | --- |
| `DIRECT` | 两位人类用户之间的直接聊天 |

其他聊天形态都会在创建、变更或返回规范聊天状态之前遭到拒绝。LocalAgent 对话归 Runtime，不会变成 Realm 的人类聊天线程。

## 读者场景：一段直接对话

你私聊另一位用户。

1. **DIRECT 载体**。Realm 准入一条 `DIRECT` thread，成员是你和对方。
2. **发送**。你的消息 commit 到 thread。
3. **实时投递**。对方通过 Socket.IO 实时收到。
4. **已读状态**。已读是规范层数据，你这一端的"已读"被记进 thread。

Thread 本身就是 Realm 的规范真相。换设备不需要重新同步，规范 thread 就是来源。

## 读者场景：跨设备的已读状态

你在桌面端读了一条消息，然后打开 Avatar 上的同一个对话。

1. **桌面端读取**。已读状态 commit 到 Realm。
2. **Avatar 打开**。Avatar 读取规范 thread，包括已读状态。
3. **Avatar 知道你已读过**。不会把读过的消息当成未读重新提示。

已读状态是平台真相，不是单个表面的本地状态。这是多表面聊天能保持一致的原因。

## Chat 与其他 Realm 表面的关系

| 表面 | 关系 |
| --- | --- |
| Social（`R-SOC-*`） | 朋友关系是私聊的前置条件；社交不持有 thread 本身 |
| Truth（`R-TRUTH-*`） | 影响世界语义的聊天可参与到真相 |
| World History（`R-WHIST-*`） | 进入规范历史的聊天事件追加到这里 |
| Runtime ConversationAnchor | LocalAgent 对话连续性归 Runtime，与 Realm 人类聊天相互独立 |

## Chat 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 持有对话连续性 | 归 Runtime ConversationAnchor |
| 持有 agent 执行 | 归 RuntimeAgentService |
| 持有 UI 渲染 | 归桌面端聊天表面 |
| 准入非直接聊天形态 | Realm Chat 只处理两位人类用户的直接聊天 |

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
