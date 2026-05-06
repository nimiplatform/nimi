# 个人主页

桌面端的个人主页面让用户看与编辑自己的资料、更新头像、看自己拥有的 Agent、看自己创建或访问过的世界。Profile 是规范化身份 — 跨每个世界都不变的同一个身份。

## Profile 装什么

| 字段 | 来源 |
| --- | --- |
| 显示名 | Realm 规范化用户身份 |
| 头像 | Realm 资产引用 |
| 拥有的 Agent | Realm Agent 读 — 这个用户拥有的 Agent |
| 创建的世界 | Realm 世界读 — 这个用户创作的世界 |
| 访问过的世界 | Realm 世界历史读视图 |
| Bio / 描述 | 用户可编辑资料字段 |

Profile 是规范化的，不是桌面端本地的。编辑 Profile 在准入的 profile 合同下改 Realm；桌面端是编辑面，不是真相持有者。

## Profile 详情作为共享面

桌面端别处（聊天里的 profile 预览、explore 里的 profile 预览）消费的是同一个 profile 详情接缝。Profile 详情读是同一个形状；消费方按需挑字段。

## 阅读场景：编辑你的 Profile

你在桌面端打开自己的 Profile，更新显示名。

1. **打开 Profile。** 桌面端从 Realm 读你的 Profile。
2. **编辑。** 你在编辑器里改显示名。
3. **保存。** 桌面端向 Realm 提交类型化 profile 修改。
4. **Realm 准入。** Profile 在准入 profile 合同下被更新。
5. **跨 App 可见。** 新显示名在每个 App 与每个世界你出现的地方都可见。
6. **审计。** Profile 改动被记下。

你的 Profile 是平台之上的同一个身份；桌面端是它的一个编辑器。

## 阅读场景：看其他用户的 Profile

你从聊天点进去看另一个用户的 Profile。

1. **Profile 预览。** 一个有界的 `ProfileDisplayDetail` 接缝解析该用户的公开 profile。
2. **你看到什么。** 显示名、头像、公开 Agent（对方设为可见的所拥有 Agent）、公开世界。
3. **你看不到什么。** 私有 profile 字段、好友列表、钱包余额 — 这些不属于公开详情。

公开 profile 有意做窄。隐私在接缝层强制，不靠客户端过滤。

## Profile 与身份

Profile 是围绕一个本身规范化、不能从 Profile 直接修改的身份的、用户可编辑面。

| 概念 | 在 Profile 里可改？ |
| --- | --- |
| 显示名 | 是 |
| 头像（视觉） | 是 |
| Bio / 描述 | 是 |
| 用户身份（规范化 id） | 否 — 创号时确定 |
| 钱包余额 | 否 — 经济事件 |
| 拥有的 Agent（Agent 本身） | 否 — Agent 权威住在 Realm |

你能编辑你怎么呈现；你不能编辑你是谁。

## 来源

- [`.nimi/spec/desktop/profile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/profile.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
