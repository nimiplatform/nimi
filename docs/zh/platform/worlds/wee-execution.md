# WEE 执行

## 状态：已准入平台方向

世界演化引擎内核框架 (`K-WEV-*`) 已在合同层面被准入——语义所有者边界、重放/检查点语义、监督边界、效果阶段排序、提交请求分阶段。WEE 是一个未来的运行时引擎，它生成格式良好的变更请求供 Realm 接受；目前尚未发布可运行的形态。

## WEE 是什么

**世界演化引擎** (WEE) 是由运行时拥有的引擎，它将参与者输入和计划事件转换为类型化的变更请求，供 Realm 接受。它是这样的契约：“一个世界应该感觉是活的——角色行动、场景进展、事件累积——但每个变更都必须是可审计的、可重放的，并且在失败时关闭。”

WEE 在运行时内部运行。Realm 仍然是规范的真相权威；WEE 生成格式良好的变更请求；Realm 决定接受或拒绝。WEE 从不绕过 Realm。

## 权威边界 (K-WEV-001..K-WEV-002)

| 所有者 | 拥有什么 |
| --- | --- |
| 运行时内核 `K-WEV-*` | 执行事件语义归属、重放语义、检查点语义、监督 + 故障隔离、效果阶段排序、提交请求分阶段 |
| 平台内核 | 放置和跨层边界文本（仅此而已） |
| SDK | 下游呈现（仅此而已） |
| Realm | 共享世界状态和历史的规范真相所有者 |

WEE 生成的运行时本地执行证据——执行事件、重放元数据、检查点元数据、监督状态、效果阶段证据、面向操作者的执行关联——保持在 **运行时语义所有权** 下。这些工件不是 Realm 的共享当前状态真相，也不是 Realm 的规范发生事实真相。

## WEE 不是工作流

| WEE | 工作流 |
| --- | --- |
| 在 Realm 权威下驱动世界演化 | 驱动通用编排 |
| 拥有自己的准入执行事件族 `K-WEV-003` | 工作流事件族 `K-WF-*` |
| 为 Realm 分阶段类型化提交请求 | 不以分阶段 Realm 提交为其主要目的 |

混淆这两者是一个已知错误。WEE 有一个独特的语义归属；即使 WEE 引入了一个稳定的执行事件或信封，其语义归属也是 `K-WEV-*`，而不是 `K-WF-*`、`K-AUDIT-*`、SDK 呈现或平台边界文本。

## 重用锚点 (K-WEV-003)

未来的 WEE 执行事件/信封契约：

| 必须重用 | 来自 |
| --- | --- |
| Realm 起源锚点 | `R-WHIST-003` |
| 提交信封锚点 | `R-WSTATE-002` |
| 运行时关联基础 | `K-AUDIT-001`、`K-AUDIT-003`、`K-AUDIT-019`、`K-AUDIT-020` |

**不得**重新定义：

- Realm 运行模式权威
- Realm `effectClass` 词汇表
- Realm 提交信封权威
- 运行时审计记录模式作为语义真相

## 提交/历史/审计边界 (K-WEV-004)

WEE 生成类型化的提交请求；Realm 接受。真相链：

| 表面 | 所有者 |
| --- | --- |
| WEE 提交请求分阶段 | 运行时 (`K-WEV-*`) |
| 提交信封形状 | Realm (`R-WSTATE-002`) |
| 状态写入授权 | Realm (按 `R-WSTATE-005` 的运行模式授权矩阵) |
| `STATE_AND_HISTORY` effectClass 的历史追加 | Realm (`R-WHIST-*`) |
| 运行时审计记录 | 运行时 (`K-AUDIT-*`) —— 执行证据，而非 Realm 语义真相 |

WEE 不发明运行模式。WEE 不发明 `effectClass`。WEE 不会默默地将 `CANON_MUTATION` 降级为 `REPLAY` 以绕过授权。

## 九个阶段

WEE 有自己的执行阶段分类法：

| 阶段 | 顺序 | 目的 |
| --- | --- | --- |
| `INGRESS` | 1 | 接收事件提案 |
| `NORMALIZE` | 2 | 规范化提案形状 |
| `SCHEDULE` | 3 | 在引擎队列中排序工作 |
| `DISPATCH` | 4 | 将工作交给正确的处理程序 |
| `TRANSITION` | 5 | 计算类型化的状态转换 |
| `EFFECT` | 6 | 计算下游效果（存在、社交、经济） |
| `COMMIT_REQUEST` | 7 | 将提议的变更作为类型化的提交请求进行分阶段 |
| `CHECKPOINT` | 8 | 为重放快照引擎的中间状态 |
| `TERMINAL` | 9 | 工作达到最终结果 |

每个阶段都有类型化的输入和输出。产生畸形输出的阶段会关闭失败；引擎不会默默地回退到通用阶段处理程序。

## 读者场景：一个世界事件通过 WEE 流动

一个计划的世界事件触发（例如，周期性的季节变化）。

1. **`INGRESS`。** WEE 接收事件提案。
2. **`NORMALIZE`。** 提案被规范化为准入事件形状。
3. **`SCHEDULE`。** 引擎对工作进行排序。
4. **`DISPATCH`。** 选择正确的处理程序。
5. **`TRANSITION`。** 计算类型化的状态转换。
6. **`EFFECT`。** 计算下游效果（存在、社交、经济）。
7. **`COMMIT_REQUEST`。** 为 Realm 分阶段变更请求。
8. **Realm 接受或拒绝。** 根据 `R-WSTATE-005` 授权矩阵。如果 `effectClass=STATE_AND_HISTORY`，则会发生历史追加。
9. **`CHECKPOINT`。** 引擎为重放快照中间状态。
10. **`TERMINAL`。** 工作达到最终结果。

每个阶段都是类型化的。每次转换都会发出运行时本地执行证据。Realm 是真相接受者；WEE 是请求生产者。

## 读者场景：从检查点重放

新节点加入或需要恢复。

1. **加载检查点。** 解析最近的准入检查点。
2. **重放事件。** 从检查点向前重放执行事件族。
3. **重新推导 Realm 真相。** 通过相同的准入管道；没有“信任检查点，跳过 Realm 准入”的静默捷径。
4. **操作者关联。** 运行时本地审计显示重放链。

重放是引擎的正确性原语。契约规定重放不会绕过准入。

## 读者场景：`REPLAY` 运行尝试追加历史

WEE 在 `REPLAY` 模式下重放先前的规范变更。

1. **执行重放路径。** WEE 重新推导原始变更。
2. **Realm 历史准入。** 根据 `R-WHIST-004`，`REPLAY` 运行不得追加共享世界历史。
3. **追加被拒绝。** 不创建新的历史行；先前的规范行保持为真相。
4. **审计反映。** 运行时本地审计显示重放；Realm 历史不变。

重放路径不会成为双重历史追加的侧门。

## WEE 不做什么

- 它不重新定义工作流事件语义。
- 它不会成为 Realm 真相权威。
- 它不会绕过 Realm 提交信封或授权矩阵。
- 它不允许运行时本地执行证据声称 Realm 真相所有权。
- 它不重新定义 `effectClass` 或运行模式。
- 它不会在畸形阶段输出时默默地回退到通用阶段处理程序。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 执行语义 + 重放 + 检查点 + 监督 + 效果阶段 + 提交请求分阶段 | 运行时 (`K-WEV-*`) |
| 执行事件语义归属（当稳定时） | `K-WEV-*` |
| 运行时本地执行证据 | 运行时（非规范） |
| Realm 共享当前状态真相 | Realm (`R-WSTATE-*`) |
| Realm 规范发生事实真相 | Realm (`R-WHIST-*`) |
| 跨层放置边界文本 | 平台内核 |
| 下游呈现 | SDK |

## 来源依据

- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)