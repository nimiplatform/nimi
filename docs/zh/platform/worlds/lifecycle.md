# 世界生命周期

Nimi 的世界是长时存活的对象。这一页走完它的生命周期：从「创作者有一个想法」到「参与者可以到访的已发布世界」，到「绑定了 extension-app 的世界」，再到「被暂停或撤销的世界」。每一步背后的状态机都在 Realm 内核里有准入。

字段层面的状态定义见 [Reference → State Machines](/zh/reference/state-machines) 与 [Reference → World Fields](/zh/reference/world-fields)。

## 撰写与发布

世界由创作者撰写。创作者工具维护规范的 `WorldCore`，以及准入的
`WorldCharacterCore`、timeline、scene、history 和产品元数据，并通过
`WorldCoreIngressPackage` 或 `CorePatch` 原子提交。

发布的那一刻是一次 core commit：一次原子事务，把已准入 core 对象状态冻结成同一个规范化锚点。一次 commit 携带：

- Core schema version
- 出处（谁发布、用什么工具）
- 校验和 / 差异元数据
- replacement 或 patch 血缘

原子性是关键。WorldCore、WorldCharacterCore、scene、timeline、history 状态必须落在同一次事务提交里。半发布的世界不被准入。

发布走 **`WorldCoreIngressPackage`** 或 **`CorePatch`**。它区分：

| 组成 | 用途 |
| --- | --- |
| Core world object | identity、ownership、time model、timeline、history 和产品元数据 |
| Core character objects | 绑定到世界的 world-owned characters |
| Runtime source snapshot 输入 | 用于按值物化 LocalAgent 的数据 |
| 治理 / 发布元数据 | 版本、出处、审计 |

Lorebook 文本与 prompt payload 永远不是这个包的规范化中心。它们可以是 source-core 字段或下游 prompt-context 输入，但不能替代 core 对象。

## 回滚也是发布操作

如果一次 release 出问题，回滚本身也是一次 release —— 不是临时改写已存在的 release。

- 回滚的 `WorldRelease` 引用上一个良性 release。
- 回滚血缘进入 release 记录。
- 世界历史把回滚记录为一次 `CANON_MUTATION` 运行。
- 出问题的 release 不从历史中删除，它被取代。

这意味着回滚保留审计可追溯性：后来读历史的人，能看到回滚回的是什么、在何时、为什么。

## App 与世界的绑定

世界在被某个 App 绑上之后才好用 —— App 是参与者真正用来与世界交互的入口。绑定是显式的，且有边界。

| 模式 | 读世界数据 | 写世界数据 | 单世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 可以 | 不可以 | 多个 |
| `extension-app` | 可以 | 可以 | 单世界至多一个活跃 |

任意时刻，一个世界至多只有一个活跃的 **extension-app** 绑定。多个 **render-app** 可以同时读同一个世界，互不抢占。

### 绑定生命周期

```
(new) ──admit──▶ active ──suspend──▶ suspended ──resume──▶ active
                  │                                          │
                  └────────────────revoke──────────────────────────▶ revoked
```

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在，没有 App 绑定 |
| `active` | 一个准入的 extension-app 正在写 |
| `suspended` | 绑定暂停；恢复需要显式重新准入 |
| `revoked` | 绑定已撤销；世界开放给新一次准入 |

暂停可逆，撤销不可逆。要换一个 extension-app，必须先撤销 —— 平台不会把写权威从一个 extension-app 静默转给另一个。

## 转场与世界可达性

已发布的世界是参与者可以转场到的去处。转场走 OASIS，详见 [OASIS](/zh/platform/worlds/oasis)。一个当前没绑 extension-app 的世界，仍然可被 render-app 读取；这是「即使没有 App 在写，真相和状态也仍然存在」的体现。

如果创作者把世界下线，原本在那个世界里的参与者默认回到 OASIS。他们的身份与标识不受影响。

## 场景：把一个世界从头发布出去

某创作者完成世界设计，准备发布。

1. **撰写真相**。真相产物：世界规则、Agent 规则、场景、呈现。
2. **暂存草稿**。最小发布候选：`importSource`、`truthDraft`、`stateDraft`、`historyDraft`。这些是创作者本地的工作集，未发布前不属于 Realm 规范化。
3. **打成 CanonicalTruthPackage**。包区分真相单元、派生输入、呈现输入、治理元数据。
4. **以 `WorldRelease` 原子发布**。这一次 commit 冻结真相、呈现、包版本，并携带出处、校验和 / 差异、回滚血缘。
5. **世界成为去处**。参与者可以经 OASIS 转场到此。render-app 可读；准入的 extension-app 可绑定写权威。
6. **审计血缘**。世界历史把这次 release 记为一次 `CANON_MUTATION` 运行。后续任何回滚也会作为另一次 `CANON_MUTATION` 运行回引这一次 release。

原子事务的形态是关键性质。平台不准入半发布的世界。

## 场景：替换活跃的 extension-app

某创作者想把活跃绑定从 extension-app A 切到 extension-app B。

1. 创作者撤销 A 的绑定。A 从 `active` 走到 `revoked`，不再持有写权威。
2. 创作者准入 B。B 的绑定从 `(new)` 走到 `active`，B 开始持有写权威。
3. 中间没有 A、B 都能写的重叠窗口。换绑不是静默转交。

为什么这么严？因为一个世界对「此刻为真的」只允许一份规范化真相。如果两个 extension-app 同时写，两份不同真相会互相覆盖。平台让转交是显式的。

## 来源依据

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
