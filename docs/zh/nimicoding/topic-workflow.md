# Topic 工作流

topic 是用来承载高风险或权威性工作的受治理工作轨。它不是每一次细小修改都需要走的流程；只有当一项工作可能改写产品真相、横跨多个所有权表面，或者结果在被接受之前必须经过显式审计时，才会引入 topic。

本页描述一个 topic 实际上怎么走。

## 典型流程

一个 topic 经过几个意义明确的步骤：

1. **定义** topic，说明为什么不能用普通的本地执行就完成。topic 取得 topic id，并写下进入理由。
2. **拆分** 工作为一个个 wave，每个 wave 有清晰的所有权域，并独立写明主要闭合目标。
3. **冻结**已选 wave 的 packet。packet 写明允许的读、允许的写、验收恒定式、负面测试、停止线和重开条件。
4. **执行预检**。预检是停止线检查，不是排练。它记录规范状态、权威属主、工作类型和并行真相立场。
5. **执行**仅限已准入的影响范围。worker 受 packet 约束。
6. **记录结果证据**，包括正向证据和负面检查。
7. **审计**这个 wave 的产出，对照验收恒定式与负面测试。
8. **关闭 wave**。仅在四个闭合维度全部满足时才能关闭。
9. **关闭 topic**。仅在所有 wave 关闭，且消费方真实接受（不是默认接受）时才能关闭。

每一步都对应 `.nimi/topics/<state>/<topic-id>/` 下的工件。这些工件构成审计轨迹。

## 为什么要拆 wave

工作一旦把无关职责打包一起关闭，风险就会变得不可控。一个 wave 始终聚焦一个所有权切面。比如规范审计、文档改写、落地页呈现就是三个不同的 wave，因为它们的权威与消费方风险都不同。

把三件事一次关掉，正是方法论想要避免的规范漂移源头。

## 场景：一个 wave 如何主动停下

假设一个 wave 的 worker 在实施过程中发现，这项工作需要 `.nimi/spec/**` 里尚不存在的产品真相。packet 的停止线明确要求此时停下。worker 的动作是：

1. 立即停止执行。
2. 把停下的原因写成工件。
3. 把 wave 退到一个状态，要求规范证据被准入之后才能恢复。

wave 不会偷偷凭空造出缺失的真相，也不会偷偷以失败收场，而是留下一份强类型记录，让真正的权威属主来决定准入什么。

## 伪闭合的样子

伪闭合指的是产出从某一个角度看像是完成了，但在另一个闭合维度上不成立。构建可以通过，但页面无法读懂；页面可以读懂，但其主张缺乏来源依据；接口可以存在，但对读者没有有意义的价值。

Nimi Coding 把这些情形当作重开条件，不当作"瑕疵尚可接受"。当前公共文档的待修复 topic 就是这种重开：wave-0 通过了机器审计，但消费方真实接受还没有被记录下来。

## 场景：因验收失败而重开 topic

假设某个 wave 通过机器证据已经关闭，但用户复核之后拒绝了结果。预期的处理方式：

1. topic 留在 pending 状态，不进入 true close。
2. pending 备注里写明"为何不关闭"的原因。
3. 在同一个 topic 下准入一个新 wave，影响范围有界。
4. 新 wave 完成自己的预检、packet、执行、审计和 closeout。
5. topic 只有在用户的接受被记录下来后才能进入 true close。

正因如此，方法论才会把 wave closeout 与 topic closeout 分开，并把 pending 看作一个真实的状态，而不是一个过渡状态。

## 来源依据

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
