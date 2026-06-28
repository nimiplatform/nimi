# 主页与通知

桌面端的主页是社交动态与快捷入口的所在；通知面板是未读计数与近期事件的所在。两者合起来，是用户在桌面端看「最近发生了什么」的入口。

## 主页

| 能力 | 行为 |
| --- | --- |
| 社交动态 | 来自社交关系的帖子与状态 |
| 快捷入口 | 常用的世界、Agent、会话 |
| 推荐内容 | 经过策划的内容呈现 |
| 跨域卡片 | 来自聊天、礼物、用户画像等其他能力域的卡片 |

主页只是入口，不是权威源。它从 Realm 的社交、帖子、世界、Agent 面读取数据，自己不做主张。

## 跨域入口

主页上的卡片可能引向其他能力域：「打开与 X 的会话」「给 Y 送一份礼物」「看 Z 的资料」。一个关键设计：**主页本身不直接改这些域的状态**。

跨域动作通过显式的回调注入。主页负责呈现入口，真正的流程由对应能力域（聊天、经济、用户画像）接手。

这样主页就不会在不知不觉中变成桌面端各处的隐性数据源。

## 通知

| 能力 | 行为 |
| --- | --- |
| 通知列表 | 近期通知 |
| 未读角标 | 在导航上可见 |
| 标记已读 | 单条或全部 |
| 取数方式 | 未读计数走轮询 |

未读计数走的是轮询，这是一处看似不起眼的运行细节，但它划出了 App 能依赖的边界。未读不开放实时推送通道；轮询模型是准入的那一种。

## 场景：在主页处理一张卡片

主页上出现一张卡片：「X 给你送了一份礼物」。

1. **卡片浮现**。主页读到对应的社交或经济事件，渲染卡片。
2. **你点「打开」**。主页不直接改状态，它走准入回调，进入经济域。
3. **由经济域接手**。钱包流程打开，定位到这份礼物。
4. **审计记录**。点击与跳转都计入审计链路。

主页是发现面，钱包是动作面。两者协作，但谁也不持有对方的真相。

## 场景：查看通知

你打开通知。

1. **列表加载**。最近的通知逐条呈现。
2. **未读计数**。角标显示 N 条未读。
3. **标记已读**。逐条阅读，标记已读，角标递减。
4. **轮询**。未读计数按准入的轮询策略刷新。

通知本身是有边界的。新的通知种类必须有对应准入的通知契约。

## 来源依据

- [`.nimi/spec/desktop/home.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/home.md)
- [`.nimi/spec/desktop/notification.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/notification.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
