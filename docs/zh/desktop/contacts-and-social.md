# 联系人与社交

桌面端的联系人与社交面让用户管理好友列表、收发好友请求、搜用户、屏蔽与解除屏蔽。社交状态规范化地住在 Realm 里；桌面端只读。

## 这个面做什么

| 功能 | 行为 |
| --- | --- |
| 好友列表 | 规范化平台真相，从 Realm 读 |
| 好友请求 | 发送、接收、接受、拒绝 |
| 用户搜索 | 按 handle / 显示名查 |
| 屏蔽 / 解除屏蔽 | 按用户；通过 Realm 准入 |
| 联系人页 | 边栏带可折叠搜索，失焦或 Esc 自动收起 |

联系人页**不是**真相来源。Realm 的社交合同（`R-SOC-*`）是。桌面端读并显示。

## 友情作为规范化真相

Nimi 里的友情是**规范化平台真相** — 一旦准入，它不属于某个世界、不属于某个 session、不属于某个 App。Alice 和 Bob 都访问过的任何世界、都用过的任何 App，里面都看得到这段友情。

| 性质 | 值 |
| --- | --- |
| 存储 | Realm `R-SOC-*` |
| 形状 | 有序对唯一性图 |
| 跨世界可见性 | 是 — 每个世界里都是同一段友情 |
| 跨 App 可见性 | 是 — 每个 Nimi App 里都是同一段友情 |
| 修改 | 通过准入 Realm 合同 |

在世界 A 加了好友的用户在世界 B 与任何 Nimi App 里都能看到这段友情，不需要再次接受。

## 阅读场景：发好友请求

你搜一个用户、发好友请求。

1. **搜索。** 联系人搜索栏接受 handle。
2. **Realm 查询。** 桌面端在准入的用户搜索面下查 Realm；结果类型化。
3. **发请求。** 你选一个用户；桌面端向 Realm 提交类型化好友请求。
4. **Realm 准入。** 请求被记下；接收方看到。
5. **接收方接受。** Realm 把友情标为 `active`（按 `R-SOC-*` 记下有序对）。
6. **处处可见。** 从这一刻起友情是规范化平台真相 — 你们任一人访问任何世界都看得见。

友情不是需要同步的桌面端本地缓存。它是规范化的 Realm 真相，桌面端只读。

## 阅读场景：屏蔽用户

你决定屏蔽某个不想再交互的人。

1. **屏蔽。** 通过联系人页向 Realm 提交屏蔽请求。
2. **Realm 准入。** 屏蔽被记下；社交图更新。
3. **跨世界生效。** 屏蔽在每个世界都生效。聊天前置条件（依赖社交状态）拒绝准入更进一步的直接对话。
4. **审计 lineage。** 屏蔽事件被记下。

任何上下文里被屏蔽的用户在所有上下文里都被屏蔽。社交图是同一份真相，不是按 App 各自一份。

## 边栏行为

联系人边栏有可折叠搜索输入，失焦或 Esc 自动收起 — 一个小细节，但这种细节让面感觉精致。

## 来源

- [`.nimi/spec/desktop/contacts.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/contacts.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
