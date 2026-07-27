# 个人主页

桌面端的个人主页，让用户查看与编辑自己的资料、更新头像、查看自己拥有的 Agent，以及自己创建或访问过的世界。Profile 是规范化的身份，跨任意世界都是同一个身份。

## Profile 承载的内容

| 字段 | 来源 |
| --- | --- |
| 显示名 | Realm 规范化的用户身份 |
| 头像 | Realm 资源引用 |
| 拥有的 Agent | Realm 的 Agent 读取 —— 该用户拥有的 Agent |
| 创建的世界 | Realm 的世界读取 —— 该用户创建的世界 |
| 访问过的世界 | Realm 世界历史的呈现 |
| 简介 | 用户可编辑的资料字段 |

Profile 是规范化的，不是桌面端本地的。编辑 Profile 是在准入的 Profile 契约下改动 Realm；桌面端只是编辑面，不是真相归属。

## Profile 详情作为共享面

桌面端其他位置（聊天里的资料预览、探索里的资料预览）都消费同一份 Profile 详情接口。读出来的形态是同一个，消费者再各自呈现。

## 场景：编辑自己的资料

你在桌面端打开个人主页，改一下显示名。

1. **打开 Profile**。桌面端从 Realm 读取你的资料。
2. **编辑**。在编辑器里把显示名改掉。
3. **保存**。桌面端向 Realm 提交一次强类型的资料改动。
4. **Realm 准入**。资料在准入的 Profile 契约下完成更新。
5. **跨 App 可见**。新显示名在所有 App、所有世界里同步生效。
6. **审计**。这次改动计入审计。

你的 Profile 在整个平台只有一份，桌面端只是它的一个编辑器。

## 场景：查看其他用户的资料

你从聊天点入另一个用户的资料。

1. **资料预览**。一个有边界的 `ProfileDisplayDetail` 接口给出该用户的公开资料。
2. **看得到的**：显示名、头像、公开的 Agent（对方设为可见的那部分）、公开的世界。
3. **看不到的**：私有字段、好友列表、钱包余额。这些不在公开详情里。

公开详情有意做窄。隐私由接口本身保证，不靠客户端过滤。

## Profile 与身份

Profile 是身份的可编辑面；身份本身是规范化的，不能直接从 Profile 改。

| 概念 | 可在 Profile 里改？ |
| --- | --- |
| 显示名 | 可以 |
| 头像 | 可以 |
| 简介 | 可以 |
| 用户身份（规范 id） | 不可以，账户创建时就固定 |
| 钱包余额 | 不可以，由经济事件决定 |
| 拥有的 Agent | 不可以，Agent 权威源在 Realm |

你能改的是「你怎么被看见」；你不能改的是「你是谁」。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
