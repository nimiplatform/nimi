# 世界字段

世界（World）概念的字段级与契约级参考。

## 世界是什么

| 属性 | 说明 |
| --- | --- |
| 身份 | 唯一的世界 id；可排序；不复用 |
| 创建 | 由已准入的世界创建者创建 |
| 持久性 | 长期存在；世界状态跨越会话边界存续；世界历史只追加 |
| 可组合性 | 通过六大平台基础协议与其他世界互操作 |
| 权威 | 规范化的世界真相、世界状态、世界历史归 Realm |

世界不是关卡、聊天室、剧本，也不是一次 App 会话。即使没人在场，世界仍在演化。

## Realm 中三个相关概念

| 概念 | 回答 | 归属契约 |
| --- | --- | --- |
| Truth | 在这个世界里规范上为真的事实，与写入时间无关 | `realm/kernel/truth-contract.md`（`R-TRUTH-*`） |
| World State | 世界此刻的样子 | `realm/kernel/world-state-contract.md`（`R-WSTATE-*`） |
| World History | 世界如何到达当前状态 | `realm/kernel/world-history-contract.md`（`R-WHIST-*`） |

三者不可互换。把它们混在一起的面会静默丢信息。

## 由 Realm 持有的相邻世界真相面

| 面 | 契约 | 规则前缀 |
| --- | --- | --- |
| 聊天 | `realm/kernel/chat-contract.md` | `R-CHAT-*` |
| 社交 | `realm/kernel/social-contract.md` | `R-SOC-*` |
| 经济 | `realm/kernel/economy-contract.md` | `R-ECON-*` |
| 资产 | `realm/kernel/asset-contract.md` | `R-ASSET-*` |
| 通行 | `realm/kernel/transit-contract.md` | `R-TRANSIT-*` |
| 绑定 | `realm/kernel/binding-contract.md` | `R-BIND-*` |
| 资源 | `realm/kernel/resource-contract.md` | `R-RSRC-*` |
| Bundle | `realm/kernel/bundle-contract.md` | `R-BNDL-*` |

## OASIS

| 属性 | 值 |
| --- | --- |
| 状态 | 系统唯一主世界；正式归在规范化真相中 |
| 归属 | 不可由任何创建者持有 |
| 替换性 | 不可由 App 约定替代 |
| 角色 | 默认返回点；世界间唯一通行枢纽 |

## App-世界绑定

一个世界同一时刻至多绑定一个活跃 extension-app。其他 App 可以以纯渲染模式使用世界数据。

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在但未绑定 App |
| `active` | 一个 extension-app 已绑定并写入 |
| `suspended` | 绑定挂起；重新绑定需要显式重新准入 |
| `revoked` | 绑定已移除；世界开放给新绑定 |

重新绑定必须先吊销，绑定不会静默转移。

## App 模式

| 模式 | 读 | 写 | 单世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 至多一个活跃 |

## 六基础协议跨一致性

涉及多项基础协议的世界状态变化必须同时满足所有相关契约：

- 一次 transit 必须同时满足 Social + Economy + Context。
- Presence 不能绕过社交准入。
- Timeflow 不能打破经济结算窗口。

六项基础协议不是相互独立的枚举，而是相互约束。

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
