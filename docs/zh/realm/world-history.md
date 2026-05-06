# 世界历史

世界历史是世界里发生过什么的**仅追加规范化记录**。出处必填。Replay 跑不能追加；只有 canon-mutating 跑可以。修正通过替代（supersession）或失效（invalidation），**永不**静默删除。

## 仅追加

| 性质 | 值 |
| --- | --- |
| 存储 | Realm `R-WHIST-*` |
| 可变性 | 仅追加 |
| 跑的种类 | `REPLAY`（不能追加）/ `CANON_MUTATION`（可以追加） |
| 出处 | 每条记录必填 |
| 修正 | 替代或失效；**永不**静默删除 |

仅追加姿态是审计基础。读者能信任历史就是发生过的事，不是事后被编辑过的。

## Replay vs Canon Mutation

| 跑的种类 | 能追加？ | 用途 |
| --- | --- | --- |
| `REPLAY` | 否 | 重建发生过什么 |
| `CANON_MUTATION` | 是 | 应用真实修改 |

Replay 跑读历史、跑类型化读视图、算结果 — 不写任何东西。Canon-mutation 跑是唯一能追加的种类。这种切分让 replay 成为真正的审计工具。

## 出处

每条历史记录带出处：谁、何时、带什么证据。出处是**必填** — 没有它就没法追加记录。

| 字段 | 用途 |
| --- | --- |
| Actor | 谁动作 |
| Time | 什么时候 |
| Evidence refs | 支撑这条记录的证据 |
| Schema version | 这条记录用什么形状 |
| Source | 谁产生这条记录（扩展 App id、系统等） |

没有出处的历史记录在准入时被拒。平台**不**静默接受未归属的记录。

## 修正

创作者（或平台）需要修正历史时，修正按准入模式走：

| 修正种类 | 行为 |
| --- | --- |
| 替代 | 新记录替代旧的；旧记录留在历史里 |
| 失效 | 记录标记成失效；原记录留下 |

**永不**准入的：静默删除。曾被 commit 的历史记录**不能**消失。用户（审计员、未来读者）总能看到「这条 commit 过，后来被 ... 替代」或「这条因为 ... 被失效」。

## 阅读场景：错动作被修正

某条历史记录被错 commit 了 — 比如某个系统 bug 把动作归到了错的参与者。

1. **原记录在。** 错归属在历史里。
2. **修正发出。** 创作者工具发出的修正 commit 一条替代记录。
3. **两条都在。** 历史里有原记录（被替代）和修正。
4. **读者看到 lineage。** 查历史的读者看到时间线：原 → 被修正替代。

原记录**不**被删。修正是它自己的类型化事件，自带出处。

## 阅读场景：审计 replay

某审计员想精确理解一段时间发生过什么 — 比如某次具体事件。

1. **Replay 跑。** 在类型化准入下读历史记录。
2. **重建。** Replay 重建状态转换、事件、读视图的链条。
3. **不追加。** Replay **不**写任何东西到历史。
4. **结果。** 审计员拿到结构化重建。

Replay 是真正的审计工具，因为它在结构上被约束不能追加。**没**「审计改了历史」的担心。

## 阅读场景：缺出处的记录尝试

某 App 试图追加一条不带出处的历史记录。

1. **准入检查。** Realm 按准入历史形状校验记录。
2. **缺出处。** 记录没满足出处要求。
3. **拒。** 记录不被准入；返回错误。
4. **App 看到类型化错误。** 「missing provenance」带 reason code。

**没**「尽力接受」的回退。没出处的记录**根本进不了历史**。

## 跨切真相与状态

历史是与真相、状态构成的三角的第三边。

| 问题 | 谁回答 |
| --- | --- |
| 什么规范化为真？ | 真相 |
| 世界现在长什么样？ | 状态 |
| 怎么变成现在这样的？ | 历史 |

把它们混在一起的面会静默丢信息。世界历史给**怎么**，不是**什么**或**现在**。

## 来源

- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/world-history-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/world-history-contract.yaml)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
