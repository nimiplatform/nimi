# 世界生命周期

Nimi 世界是长期存在的东西。本页跟踪生命周期，从「创作者有个想法」到「参与者可以访问的已发布世界」到「绑了 extension-app 的世界」到「可被暂停或吊销的世界」。每一步背后的状态机器都在 realm kernel 里被认可。

字段级状态定义见 [Reference → State Machines](/zh/reference/state-machines) 和 [Reference → World Fields](/zh/reference/world-fields)。

## 创作与发布

世界由创作者创作。创作者的工具产生**真相** — `WorldRule` 项、绑到世界的 `AgentRule` 项、场景、Agent、projection — 然后打包发布。

发布的瞬间是 **`WorldRelease`**：一次原子事务，把真相、projection、包版本冻结进一个规范锚点。一次 release 携带：

- 包版本
- 来源（谁发布、用什么工具）
- 校验和 / diff 元数据
- 回滚 lineage

原子性很重要。真相、agent rule scope、projection 都在一次事务性提交里落地。半发布的世界不被准入。

Release 通过 **`CanonicalTruthPackage`** 发布 — 官方上游真相 ingress 对象。它区分：

| 组件 | 用途 |
| --- | --- |
| 规范真相单元 | 世界规则、Agent 规则、场景规则等 |
| 推导 / 继承输入 | 世界真相如何约束 Agent 真相 |
| Projection 输入 | 世界支持什么读视图 |
| 治理 / release 元数据 | 版本、来源、审计 |

Lorebook 文本和 prompt 载荷**永远不**是包的规范中心。它们可以是 projection 的输入，但不是真相本身。

## 回滚是 release 操作

如果一次 release 有问题，回滚本身就是一次 release — 不是临时改写现有 release。

- 一次回滚 `WorldRelease` 引用之前的好 release。
- 回滚 lineage 是 release 记录的一部分。
- 世界历史把回滚记成一次 `CANON_MUTATION` run。
- 坏的 release **不**从历史里删除；它被 supersede。

也就是说回滚保留审计可追溯性：将来读历史的人能看到什么被回滚、何时、为什么。

## App-世界绑定

世界绑了 App 才最有用 — App 是参与者实际用来跟世界互动的东西。绑定是显式且有界的。

| 模式 | 读世界数据 | 写世界数据 | 一个世界里并存数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 同时最多一个 active |

一个世界在任何时刻最多有一个 active 的 **extension-app** 绑定。多个 **render-app** 可以同时读同一个世界；它们不互相 gate。

### 绑定生命周期

```
(new) ──admit──▶ active ──suspend──▶ suspended ──resume──▶ active
                  │                                          │
                  └────────────────revoke──────────────────────────▶ revoked
```

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在；没有 App 绑 |
| `active` | 一个被准入的 extension-app 绑了，正在写 |
| `suspended` | 绑定被暂停；要重绑必须显式重新准入 |
| `revoked` | 绑定被移除；世界可以被新准入接管 |

暂停可逆；吊销不可逆。重新绑定要先吊销 — 平台**不会**无声地把写权威从一个 extension-app 转到另一个。

## Transit 与世界可用性

发布的世界变成参与者可以跨越过去的目的地。跨越走 OASIS — 见 [OASIS](/zh/platform/worlds/oasis)。一个当前没有 extension-app 绑定的世界仍然能被 render-app 读；这是真相和状态的事，即使没有 App 在主动写。

如果一个世界被创作者下线，里面的参与者默认回到 OASIS。他们的身份和地位不受影响。

## 阅读场景：端到端发布一个世界

一个创作者完成了一个世界的设计想发布。

1. **写真相**。真相产物：世界规则、Agent 规则、场景、projection。
2. **暂存草稿**。最小发布候选：`importSource`、`truthDraft`、`stateDraft`、`historyDraft`。这些是创作者本地工作集，**不**是 Realm 规范，直到发布。
3. **打包成 CanonicalTruthPackage**。包区分真相单元、推导输入、projection 输入、治理元数据。
4. **以 `WorldRelease` 原子发布**。Release 提交冻结真相、projection、包版本。它带着来源、校验和 / diff、回滚 lineage。
5. **世界变成目的地**。参与者可以通过 OASIS 跨越到这个世界。Render-app 可以读；被准入的 extension-app 可以绑定拿写权威。
6. **审计 lineage**。世界历史把这次 release 记成一次 `CANON_MUTATION` run。将来任何回滚都被记成另一次 `CANON_MUTATION` run，引用这次 release。

原子事务形状是关键属性。平台**不**接纳半发布的世界。

## 阅读场景：换 active extension-app

创作者想从 extension-app A 切到 extension-app B。

1. 创作者吊销 A 的绑定。A 的绑定从 `active` 走到 `revoked`。A 不再有写权威。
2. 创作者准入 B。B 的绑定从 `(new)` 走到 `active`。B 现在有写权威。
3. **没有**重叠窗口让 A 和 B 都能写。重新绑定**不是**无声转移。

为什么这么严？因为一个世界只有一个规范的"现在是什么真相"。如果两个 extension-app 都能写，两个不同的真相会赛跑互相覆盖。平台让这个切换变成显式的。

## 来源

- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/binding.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/binding.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
