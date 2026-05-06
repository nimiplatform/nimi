# World 字段

世界概念的字段与合同级参考。

## 世界是什么

| 性质 | 描述 |
| --- | --- |
| 身份 | 唯一世界 id；可排序；不可回收 |
| 创作 | 由准入的世界创作者创建 |
| 持久 | 长期存在；世界状态跨 session 边界存活；世界历史仅追加 |
| 可组合 | 经六个平台基础协议跟其他世界互操作 |
| 权威 | Realm 拥有规范化世界真相、世界状态、世界历史 |

世界**不**是关卡、聊天室、campaign、App session。世界即便没参与者在场也持续演化。

## 三个相关 Realm 概念

| 概念 | 它回答什么 | Owner 合同 |
| --- | --- | --- |
| 真相 | 这个世界里规范化的真是什么，**不管**何时写的 | `realm/kernel/truth-contract.md`（`R-TRUTH-*`） |
| 世界状态 | 世界现在长什么样 | `realm/kernel/world-state-contract.md`（`R-WSTATE-*`） |
| 世界历史 | 世界怎么到当前状态的 | `realm/kernel/world-history-contract.md`（`R-WHIST-*`） |

这三个**不**可互换。混淆它们的面会静默丢信息。

## 作为世界真相被拥有的相邻 Realm 面

| 面 | 合同 | 规则前缀 |
| --- | --- | --- |
| Chat | `realm/kernel/chat-contract.md` | `R-CHAT-*` |
| Social | `realm/kernel/social-contract.md` | `R-SOC-*` |
| Economy | `realm/kernel/economy-contract.md` | `R-ECON-*` |
| Asset | `realm/kernel/asset-contract.md` | `R-ASSET-*` |
| Transit | `realm/kernel/transit-contract.md` | `R-TRANSIT-*` |
| Binding | `realm/kernel/binding-contract.md` | `R-BIND-*` |
| Resource | `realm/kernel/resource-contract.md` | `R-RSRC-*` |
| Bundle | `realm/kernel/bundle-contract.md` | `R-BNDL-*` |

## OASIS

| 性质 | 值 |
| --- | --- |
| 状态 | 唯一系统主世界；正式属于规范化真相 |
| 拥有 | **任何**创作者**无法**拥有 |
| 可替代性 | **无法**被 App 约定替代 |
| 角色 | 默认返回点和世界之间唯一通行中心 |

## App-世界绑定

世界同一时刻至多一个活跃 extension-app 绑定。其他 App 可在 render-only 模式下消费世界数据。

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在但没 App 绑定 |
| `active` | 一个 extension-app 绑定并写 |
| `suspended` | 绑定被暂停；重绑要显式重新准入 |
| `revoked` | 绑定被移除；世界对新绑定可用 |

重绑要先撤销；绑定**不**静默转移。

## App 模式

| 模式 | 读 | 写 | 每个世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 至多一个活跃 |

## 六基础协议跨一致

涉及多个基础协议的世界转换必须同时满足所有相关基础协议合同：

- 通行必须同时满足 Social + Economy + Context。
- 在场**不能**绕过社交准入。
- Timeflow **不能**破坏经济结算窗口。

六基础协议**不**是独立 enum；它们互相约束。

## 世界演化引擎（Runtime 拥有）

世界跑在 Runtime 内时（Runtime 托管的世界体验），世界演化引擎治理它的演化。WEE 有自己的执行阶段分类，跟 Workflow 不同：

`INGRESS → NORMALIZE → SCHEDULE → DISPATCH → TRANSITION → EFFECT → COMMIT_REQUEST → CHECKPOINT → TERMINAL`

Replay 是仅记录回放：WEE V1 从记下的事件、检查点、commit-request 结果回放。回放期间**没**重新推断、**没**新路由选择。

| 字段 | 拥有者 |
| --- | --- |
| WEE 事件语义 | `runtime/kernel/world-evolution-engine-contract.md`（`K-WEV-*`） |
| Workflow 部分复用硬切 | `runtime/kernel/world-evolution-engine-contract.md` |

## 来源

- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
