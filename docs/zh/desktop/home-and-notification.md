# 主页与通知

桌面端的主页面是社交 feed 与快捷入口；通知面是未读数与近期通知视图。两个加起来是桌面端的「有什么新内容」面。

## 主页

| 功能 | 行为 |
| --- | --- |
| 社交 feed | 来自你社交图的发帖与更新 |
| 快捷入口 | 常去的目的地（世界、Agent、对话） |
| 推荐内容 | 受策展的内容 |
| 跨域动态卡 | 显示来自其他域的动态卡（聊天、礼物、profile 等） |

主页是目的地，不是权威。它从 Realm 社交、Realm 动态、Realm 世界 / Agent 面读，再呈现。

## 跨域入口

主页动态卡可能露出到其他域的入口 — 「跟 X 聊天」、「给 Y 发礼物」、「看 Z 的 profile」。一个关键设计选择：**主页不直接拥有那些修改**。

跨域动作通过显式所有者回调注入。主页呈现入口；所有者域（聊天、经济、profile）处理实际流。

这就是让主页**不**意外变成桌面端每个面的影子权威的原因。

## 通知

| 功能 | 行为 |
| --- | --- |
| 通知列表 | 近期通知 |
| 未读 badge | nav 里可见 |
| 标为已读 | 单条或全部 |
| Polling | 未读数走 polling |

未读数走 polling — 一个小的运行细节，但对于 App 与 mod 能依赖什么这点重要。未读的实时推送**未被准入**；polling 模型才被准入。

## 阅读场景：响应一张主页卡

你看到一张主页卡 — 「X 给你发了礼物」。

1. **卡呈现。** 主页读相关社交 / 经济事件；渲染卡片。
2. **你点「打开」。** 主页**不**直接修改状态；通过准入回调调用所有者域（经济）。
3. **经济处理。** 钱包流以礼物为焦点打开。
4. **审计 lineage。** 用户点击被记下；导航被审计。

主页是发现面。钱包是动作面。两者协作但任一边都不拥有对方的真相。

## 阅读场景：看通知

你打开通知。

1. **列表加载。** 近期通知显示。
2. **未读数。** Badge 显示 N 条未读。
3. **标为已读。** 你读了；标为已读；badge 减一。
4. **Polling。** 未读数在准入 polling 策略下 polling。

通知是有界的；新通知种类需要准入的通知合同。

## 来源

- [`.nimi/spec/desktop/home.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/home.md)
- [`.nimi/spec/desktop/notification.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/notification.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
