# 状态与历史

> 状态：运行中 (Running). 世界状态 (`R-WSTATE-*`) 和世界历史 (`R-WHIST-*`) 是具有不同且互补角色的领域权威表面。

一个世界有两个持久的领域拥有的表面：**状态**（当前的真实情况）和**历史**（发生的事情）。它们不是同一件事，不能互相替代，并且事件影响哪个表面的规则是合同约定的。

## 状态是什么

| 属性 | 值 |
| --- | --- |
| 权威 | `realm/kernel/world-state-contract.md` (`R-WSTATE-*`) |
| 目的 | 世界的共享当前状态 |
| 范围 | 仅限持久共享范围：`WORLD`, `ENTITY`, `RELATION` |
| 变更方法 | 显式提交信封 |
| 故事本地控制变量 | 不在领域内 —— 它们保持在外 |

状态表达了当前的共享真相：一个角色在这个位置，这种关系有这种状态，这个实体有这些属性。状态只能通过提交信封来改变。

## 历史是什么

| 属性 | 值 |
| --- | --- |
| 权威 | `realm/kernel/world-history-contract.md` (`R-WHIST-*`) |
| 目的 | 规范的事实记录 |
| 追加姿态 | 显式追加 |
| 故事追踪/原始回合日志/应用私有存档 | 不在领域历史中 |
| 每个事件的来源 | `appId`, `sessionId`, `actorRefs`, `reason`, `evidenceRefs`, 相关的状态/真相锚点 |
| 变更 | 仅追加；通过取代或无效化进行修正；无静默硬删除 |

历史存储了已发生的规范记录：这个回合提交了这个变更，这个事件被这个应用在该运行模式下准入。它不是每个模型令牌的日志。它是已准入的规范事件记录。

## `effectClass` 决定更新哪个表面

每个提交信封声明一个 `effectClass`：

| `effectClass` | 状态写入 | 历史追加 |
| --- | --- | --- |
| `NONE` | 否 | 否 |
| `STATE_ONLY` | 是 | 否 |
| `STATE_AND_HISTORY` | 是 | 是 |

客户端不得发明额外的变更类别。封闭枚举是合同的一部分。

## 运行模式授权

状态写入需要通过 `(appId, schemaId, schemaVersion, effectClass) -> runMode` 矩阵加上失败关闭的模式验证来进行显式的应用授权。缺少模式字段、未识别的范围、无法验证的来源或未经授权的运行模式将拒绝提交。

历史追加约束：

| 规则 | 值 |
| --- | --- |
| `REPLAY` 运行不得追加共享世界历史 | `R-WHIST-004` |
| 只有由矩阵授权的 `CANON_MUTATION` 行可以追加 | `R-WHIST-004` |
| 应用私有叙述存档 | 应用所有，不是领域历史 (`R-WHIST-006`) |

## 为什么要有两个表面

如果状态吸收了历史：
- “这个实体曾经在其他位置吗？”变得无法回答
- 审计/重放/重建变得不可能
- 通过静默覆盖进行的修正常常会导致失去真相

如果历史吸收了状态：
- “这个实体现在在哪里？”需要从过去的事件流中重构
- 应用读取支付了无界的成本
- 当并发追加竞争时，“现在”变得模糊

两个表面，一个真相模型。每个事件通过 `effectClass` 显式声明它影响哪些表面。

## 读者场景：一个 `STATE_ONLY` 变更

一个应用写入了一个没有历史意义的瞬态世界状态更新。

1. **提交信封。** 应用提交 `effectClass: STATE_ONLY`。
2. **领域验证。** 模式、来源、运行模式授权都通过。
3. **状态更新。** 世界当前状态反映了变化。
4. **历史不变。** 没有追加历史行；变更是状态性的但不是历史性的。

## 读者场景：一个 `STATE_AND_HISTORY` 变更

一个应用写入了一个具有规范意义的变更。

1. **提交信封。** `effectClass: STATE_AND_HISTORY`。
2. **领域验证。** 同样的检查；此外还检查运行模式是否授权历史追加 (`CANON_MUTATION`)。
3. **状态更新。** 世界当前状态反映了变化。
4. **历史追加。** 一个新的带有完整来源的历史行被追加。
5. **未来的重放或修正**可以引用这一行。

## 读者场景：一个修正

一个较早的历史行需要被修正。

1. **无静默硬删除。** 原始行保留；修正是通过取代或无效化事件建模的。
2. **追加一个修正事件。** 新事件引用先前的行并解释取代。
3. **历史保持仅追加。** 审查者可以看到原始行和修正行；真相链保持完整。

仅追加不变性使得历史成为一个可靠的多年审计表面。

## 读者场景：一个 REPLAY 运行尝试写入历史

一个 WEE 重放路径试图在重放期间追加历史。

1. **重放执行。** 在 `REPLAY` 模式下重新推导变更。
2. **追加被阻止。** 根据 `R-WHIST-004`，`REPLAY` 运行不得追加共享历史。
3. **状态写入可以继续** 如果运行模式授权（根据矩阵）；历史不会被复制。
4. **审计反映** 重放路径；领域历史保持不变。

## 读者场景：一个应用需要自己的叙述存档

一个应用需要其自己的每会话叙述日志。

1. **领域历史不是存放的地方。** 领域历史只存储规范的事实。
2. **应用自有存档。** 应用在其自己的所有权下存储叙述存档 (`R-WHIST-006`)。
3. **不作为领域历史表示。** 应用不将其存档投影为领域的规范世界历史。

## 状态和历史不做的事情

- 它们不会静默合并：状态不是历史；历史不是状态。
- `effectClass` 不接受额外的值。
- 领域不优先考虑显式提交信封之外的隐藏写入路径。
- `REPLAY` 运行不会静默获得历史追加。
- 应用私有存档不会成为领域的规范真相。
- 历史行不会被静默硬删除。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 共享当前状态 | 领域 (`R-WSTATE-*`) |
| 规范的事实 | 领域 (`R-WHIST-*`) |
| 提交信封权威 | 领域 (`R-WSTATE-002`) |
| 运行模式授权矩阵 | 领域 (`R-WSTATE-005`) |
| `effectClass` 封闭枚举 | 领域 (`R-WSTATE-004`) |
| WEE 侧提交请求暂存 | 运行时（参见 [WEE 执行](/platform/worlds/wee-execution)）|

## 来源依据

- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/domain-state-machines.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/domain-state-machines.yaml)
- [`.nimi/spec/realm/kernel/projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/projection-contract.md)