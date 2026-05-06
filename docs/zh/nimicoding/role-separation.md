# 角色分离

三个角色，严格分离。**Auditor 不是换了顶帽子的 worker** —— 这是方法论里最具特色的一条运作规则。

## 三个角色

| 角色 | 拥有 | 不能做 |
| --- | --- | --- |
| Manager | Wave 图、packet 准入、manager 判断、closeout 同步 | 一边改语义一边把生产范围悄悄实现进去 |
| Worker | 一份准入的 packet、有界的写集合执行 | 扩 owner 域、削弱 fail-close 规则 |
| Auditor | 结构性 review、漂移检测、闭合核验、spec 类 packet 的 pre-implementation 权威收敛证据 | 把缺失范围悄悄变成「以后再说」、审计期间动权威或动实现、决定语义是否可接受或决定 packet 是否准入 |

被禁的动作是有意写出来的：它们就是各角色最容易越权的地方。

## Manager

Manager 这个角色：

- 决定哪个 wave 被准入。
- 把这个 wave 的 packet 冻结。
- 记录审计结果。
- 决定 wave 是进入 closeout、还是退回修改、还是准入 continuation。
- 记录 topic 级别的 closeout 决策。

Manager 在最严格的场景下（`manager_worker_auditor` 执行模式）**不写生产代码**。在 `inline_manager_worker` 模式下（仅限低风险工作）manager 与 worker 可以是同一个循环。

Manager 最关键的约束：不要一边改语义一边把生产范围悄悄实现进去。语义要变，那就单独走一次准入步骤，不能作为执行的副作用。

## Worker

Worker 这个角色：

- 执行一份准入的 packet。
- 只读 `allowed_reads` 准许的范围。
- 只写 `allowed_writes` 准许的范围。
- 在 packet 的 stop line 处停下。

Worker 最关键的约束：不要扩 owner 域。一旦工作要碰到 packet 的 owner 域之外的表面，worker 应当停下来，回到 manager 那边重新框 packet。

Worker 也不能削弱 fail-close 规则。一个「贴心」给合同失败加上一段 fallback 的 worker，引入的就是 `placeholder_success`。

## Auditor

Auditor 是被低估得最厉害的一环。**典型的 AI 工作流里，produce 代码的循环跟 review 代码的循环是同一个循环。这种结构有一个众所周知的失败模式：循环自己的盲点会一起穿过 review。**

`manager_worker_auditor` 模式下的 auditor 在结构上是分离的。在当前的宿主实现里，这意味着另一段 AI session、或者另一家厂商。

Auditor 做的事：

- 结构性 review。
- 漂移检测。
- 跨四个维度核验闭合。
- Packet 触到 spec / authority / redesign 表面时，提供 pre-implementation 权威收敛证据。

Auditor **不**把缺失范围悄悄变成「以后再说」。审计如果发现一个 gap，那就把 gap 显式点出来；「以后会有人修」不是一个审计结论。

Auditor **不**在审计期间动权威或动实现。审计是只读的。

Auditor **不**决定语义是否可接受、也不决定 packet 是否准入。这些决定属于 manager。Auditor 的输出是「候选证据」；manager 在 dispatch 实现之前把审计结论登记在案。

## 为什么要做这种分离

如果 manager / worker / auditor 塌成一个循环：

| 病 | 会发生什么 |
| --- | --- |
| 自审 | 循环自己的盲点穿过 review |
| 范围蠕变 | Worker 悄悄扩范围，因为没有独立的关 |
| 软通过 | Auditor 的标准向 worker 的现实收敛 |
| 漂移正常化 | 反复出现的模式被当作「没事」 |

如果它们是分离的：

| 行为 | 它带来什么 |
| --- | --- |
| 独立审计 | 盲点不一样；一个循环抓住另一个循环漏掉的 |
| 硬范围边界 | Worker 被冻结的 packet 框住；manager 只能用新的 packet 重新框范围 |
| 标准保持 | Auditor 的标准不会向 worker 的现实漂 |
| 漂移检测 | 反复的模式得到具名（目录在长大） |

## 权威收敛门

一个具体场景：当 packet 类别是 `authority` / `spec` / `redesign` / `preflight`，并且引用了 `.nimi/spec/`，manager 必须在 dispatch worker **之前**先把一个 auditor PASS 裁定记下来。

| 步骤 | 拥有者 |
| --- | --- |
| 实现前审计 | Auditor（独立） |
| 裁定登记 | Manager（仅记录） |
| Dispatch worker | Manager（审计 PASS 之后才准入 packet） |

实现落地后，机械相变之前，还需要一次 follow-up 判断 PASS。

未解决的 blocking finding 走 fail-close。

## 阅读场景：同循环 review 为什么会失败

你在用 AI 做一次较实质的改动。你让同一个 AI 来 review 它自己的产出。

这个 AI review 完了说「都看着 OK」。你 ship 出去。一周后你发现这次改动引入了一个 `legacy_alias` 模式，撰写时没抓到，review 时也没抓到。

这就是结构性的失败模式。同一个循环的盲点不会因为它换了角色就改变。AI 不是 review 时变得更不仔细，而是它对「什么算 OK」有同一套模型。

方法论的回应：让 auditor 是**另一个循环**。另一段 session、另一家厂商、另一台宿主。auditor 的盲点就是不一样的。

## 阅读场景：solo 创业者用 auditor 模式

你是 solo 创业者，重度用 AI。没有团队提供结构性 review。你只有自己加自己的 AI 宿主。

方法论的回应：

| 循环 | 角色 |
| --- | --- |
| 你的主线 AI session | Manager + worker |
| 一段单独的 AI session（另一家厂商或另一段 session） | Auditor |
| 你 | 最终接受度的关 |

你用的还是团队会用的 `manager_worker_auditor` 模型，只不过 auditor 的角色被路由到另一个 AI session 上。结构性的分离保住了，不需要更多人来。

这就是方法论给 solo 创业者的卖点：用走另一个 AI 循环的审计，去模拟团队本会提供的 review 冗余。

## 阅读场景：manager 拒绝一次准入

某 worker 提交一份 packet 求准入。Manager 来 review：

- 权威拥有者：清楚。
- Allowed reads：有界。
- Allowed writes：有界。
- Acceptance invariant：显式。
- Negative test：显式。
- Stop line：显式。
- Forbidden shortcut：声明完整。

但是：这个 packet 是 spec-touching 类别，没有 auditor PASS 记录。Manager 拒绝准入。

| 步骤 | 发生什么 |
| --- | --- |
| Worker 请求准入 | 已提交 |
| Manager 检查门 | 权威收敛门没满足 |
| 拒绝 | 准入被驳回 |
| 后续路径 | 跑实现前审计；记录 PASS；重新提交 |

拒绝**不是可选项**。方法论的硬规则：未解决的 blocking finding 走 fail-close。

## 来源

- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
