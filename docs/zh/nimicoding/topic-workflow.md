# Topic 工作流

一个 topic 是一条受治理的工作主线，专门用于高风险或承担权威的工作。它不是每一处小改动都得用。要用它的场景是：这次工作可能改变产品真相、可能跨多个 owner 表面、或者拿到的结果在被接受之前需要显式审计。

这一页讲一个 topic 实际怎么走。

## 典型流程

一个 topic 走过几个有名字的状态：

1. **定义** topic，并讲清楚为什么普通的本地执行不够用。Topic 拿到 topic id 与一份 entry justification。
2. **拆分**工作为若干 wave，每个 wave 有清晰的 owner 域。每个 wave 自己有 primary closure goal。
3. **冻结** 选定 wave 的 packet。Packet 写明允许读什么、允许写什么、acceptance invariant、negative test、stop line、reopen 条件。
4. **跑 preflight**，在实现之前。Preflight 是一道 stop-line 检查，不是预演。它登记 spec 状态、authority owner、work type、parallel-truth posture。
5. **执行**仅限被准入的范围。Worker 被 packet 框住。
6. **登记结果证据**，包含正向证据与 negative check。
7. **审计** wave 输出，对照 acceptance invariant 与 negative test。
8. **闭 wave**，要在四个闭合维度都满足时才闭。
9. **闭 topic**，要在所有 wave 都闭、且消费方接受度是真接受、不是假设时才闭。

每一步对应一份工件，住在 `.nimi/topics/<state>/<topic-id>/`。这些工件就是审计 trail。

## Wave 为什么有价值

把无关的责任在同一个闭合里一起闭，大工作就开始变得不安全。Wave 让一次 owner cut 保持在焦点内。比如，一次 spec 审计、一次文档重写、一次 landing 页准入是三个不同的 wave —— 它们的权威与消费方风险都不一样。

把这三件事一起闭，相当于打开方法论本来就要挡住的那种 spec 漂移机会。

## 阅读场景：一个 wave 怎么主动停下来

某 wave 的 worker 在实现中途发现：这次工作要用到某条产品真相，可这条真相在 `.nimi/spec/**` 里还没有。Packet 的 stop line 写明这种情况下要停。Worker 这时：

1. 停下执行。
2. 把停下的原因登记成一份工件。
3. Wave 回到一个状态：要拿到准入的 spec 证据才能继续。

Wave 不会自己悄悄编出缺失的真相。它也不会悄悄失败 —— 它留下一份类型化记录，让真正有权威的 owner 来决定准入什么。

## 伪闭合长什么样

伪闭合是这样的状态：从某一个角度看输出是完整的，可在另一个闭合维度上没过。Build 可以过，可页面读不通。页面可以读得通，可它的声明没有 spec 出处。一条路由可以存在，可它对读者没有任何意义。

Nimi Coding 把这些当 reopen 条件来对待，不当作可接受的粗糙边缘。当前还在 pending 的这个文档 remediation topic 就是一次这样的 reopen：wave-0 在机器审计上闭了，可消费方人审接受度没记下来。

## 阅读场景：接受度未过之后 topic 怎么 reopen

某 wave 在机器证据上闭了，可用户复审之后拒绝了结果。预期的流程：

1. Topic 留在 pending，不 true-close。
2. Pending-note 登记没闭的理由。
3. 在同一个 topic 下准入一个新 wave，范围有界。
4. 新 wave 走它自己的 preflight、packet、执行、审计、closeout。
5. 用户接受度被记下来，topic 才 true-close。

这就是方法论为什么把 wave closeout 跟 topic closeout 区分开来，也是为什么 pending 是一个真实状态，而不是一个过渡状态。

## 来源

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
