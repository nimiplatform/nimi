# Topic 工作流 (Topic Workflow)

Topic 是一条处于被治理状态的工作主线，专为那些高风险或涉及权威变动的任务而生。它并不需要被滥用于每一个微小的代码修补上。只有当你的工作可能会改变产品真相、横跨多个归属域表面（Owner surfaces），或者它产出的结果在被正式接受前必须经过显式的审计时，才需要动用 Topic 纪律。

本页将为你详细拆解一个 Topic 的实际流转过程。

## 典型的工作流

一个 Topic 会在一个极简但定义清晰的状态机中流转：

1. **定义 (Define)**：创建 Topic，并说明为什么普通的本地执行无法胜任这项任务。Topic 会获得一个唯一的 ID 以及一份准入辩护理由（Entry justification）。
2. **拆分 (Split)**：将宏大的任务拆解成多个 Wave。每个 Wave 都必须有清晰的归属域（Owner domain），以及它独有的首要闭合目标（Primary closure goal）。
3. **冻结 (Freeze)**：为选定的 Wave 冻结一个工作包（Packet）。这个 Packet 将白纸黑字地声明：允许查阅的范围、允许写入的边界、验收恒定式、反向测试、止损线以及重开条件。
4. **预检 (Run preflight)**：在正式写代码之前运行预检。预检是一次针对止损线的核对，绝不是什么“演习”。它负责锁定规范（Spec）的状态、查明权威所有者、界定工作类型，并明确对待并行真相（Parallel truth）的姿态。
5. **执行 (Execute)**：严格在已准入的范围内执行代码落地。执行者（Worker）被 Packet 的边界死死锁住。
6. **归档结果证据 (Record result evidence)**：将执行产出的结果打包归档，这既包括正向的成功证据，也包括反向的检查记录。
7. **审计 (Audit)**：依据前面写死的验收恒定式和反向测试，对该 Wave 的产出进行冷酷的评审。
8. **闭合 Wave (Close the wave)**：只有当四个闭合维度全部得到满足时，才允许将 Wave 标记为已闭合。
9. **闭合 Topic (Close the topic)**：只有当所有的 Wave 均已闭合，并且消费方给出了真实（而非你主观假设的）接受度反馈后，整个 Topic 才宣告终结。

以上每一步都会在 `.nimi/topics/<state>/<topic-id>/` 目录下留下一份对应的工件。这些工件拼接在一起，就构成了牢不可破的审计追踪链条（Audit trail）。

## 为什么需要分出 Wave？

当毫不相干的职责被混在一起收尾时，大型的重构任务就会滑向失控。Wave 的作用，就是确保每一次“归属权切割（Owner cut）”都能被单独聚焦。

例如：一次 Spec 审计、一次文档重写，以及一次向 Landing 页的投影，绝对应该被划分为三个不同的 Wave。因为它们各自面临的权威风险和消费方风险截然不同。如果你试图把这三件事混在一个锅里闭合，那你正好给了“隐性规范漂移”可乘之机——而这正是本方法论立誓要剿灭的死敌。

## 场景案例：Wave 是如何自我熔断的

假设一个 Wave 的执行者（Worker）写代码写到一半，突然发现这项工作需要依赖一条尚未被 `.nimi/spec/**` 收录的新“产品真相”。而 Packet 里的止损线明确规定：遇到这种情况，必须停手。于是 Worker 会：

1. 立即停止执行。
2. 把停工的具体原因作为一份工件记录下来。
3. 把 Wave 退回等待状态，直到那份缺失的 Spec 真相被正式准入后，才能恢复工作。

**注意：Wave 绝不会自作主张去捏造那份缺失的真相，也绝不会静悄悄地挂掉。** 它会留下一份类型化的出错记录，把“到底准不准入这条真相”的决定权，交还给真正的权威所有者。

## 伪闭合到底长什么样？

伪闭合（False closure）指的是：工作产出在某个视角下看起来已经大功告成，但在另一个闭合维度上却彻底翻车。

构建可能是一路绿灯的，但页面写得根本没法读；页面可能写得花团锦簇，但里头的说辞压根没有任何权威来源的背书；一个 API 路由可能被完美实现了，但消费者根本不需要它。

Nimi Coding 把这些情况统统视为“重开条件（Reopen conditions）”，绝不把它们当成“以后慢慢修的无伤大雅的小毛病”。

此前我们处理“公开文档修复”的任务就是一个教科书般的重开案例：Wave-0 在机器审计层面确实闭合了，但人类消费者还没点头接受呢。所以它不是完成了，而是伪闭合。

## 场景案例：验收失败后，Topic 是如何重开的

假设一个 Wave 在机器收集的证据层面已经闭合了，但用户审阅了结果之后，觉得不行，拒绝了它。正确的处理流程是这样的：

1. 这个 Topic 会老老实实呆在 `pending`（挂起）状态，绝不会滑向真正闭合（True-close）。
2. 在挂起说明（Pending note）中，详细记录下它为何没能闭合的原因。
3. 就在这个 Topic 之下，准入一个新的、边界依然受限的 Wave。
4. 这个新的 Wave 将完整地走一遍它自己的预检、工作包冻结、执行、审计和收尾流程。
5. 只有当那个人类验收的通行证真正被记录在案时，这个 Topic 才会被放行，走向 True-close。

看明白了吗？这就是为什么方法论非要把“Wave 闭合”和“Topic 闭合”拆成两本账，以及为什么 `pending` 是一个实实在在的机器状态，绝不是个虚头巴脑的过渡词。

## 来源依据

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)