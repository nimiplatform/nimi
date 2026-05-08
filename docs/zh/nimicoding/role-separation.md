# 角色分离 (Role Separation)

三个角色。严格分离。最重要的一条红线是：**审计者（Auditor）绝不能只是执行者（Worker）换了个马甲**——这是本方法论在实际运作中最核心、最独特的准则。

## 三大角色定义

| 角色 | 核心职责 | 严禁行为 |
| --- | --- | --- |
| **管理者 (Manager)** | 掌控 Wave 拓扑图、Packet 准入、管理者裁决以及收尾同步。 | 严禁在修改代码语义的同时，悄悄把生产代码也一并实现了。 |
| **执行者 (Worker)** | 专注执行单一已准入的 Packet，严格在受限的范围内进行代码写入。 | 严禁擅自扩大归属域（Owner domain），严禁为了图方便而削弱安全报错（Fail-closed）规则。 |
| **审计者 (Auditor)** | 结构性评审、设计漂移检测、闭合维度的核验，并在 Packet 触碰规范、权威或重新设计表面时提供“实现前”的权威收敛证据。 | 严禁把范围缺失的问题说成“以后再补”；严禁在审计过程中偷偷修改权威配置或实现代码；无权自作主张决定语义的接受度或 Packet 的准入。 |

上面列出的严禁行为并不是随便写的。它们正是各个角色在实际操作中最容易越权犯错的“重灾区”。

## 管理者 (Manager)

Manager 是掌控全局的角色，负责：
- 决定当前准入哪一个 Wave。
- 冻结该 Wave 对应的 Packet。
- 将审计结果登记在案。
- 裁定该 Wave 是进入闭合收尾、打回修订，还是准入一个延续包（Continuation）。
- 记录 Topic 级别的最终决策。

在最严格的 `manager_worker_auditor` 执行模式下，Manager **绝不亲自编写生产代码**。只有在针对低风险任务的 `inline_manager_worker` 模式下，Manager 和 Worker 才允许由同一个控制循环（Loop）来扮演。

Manager 最核心的底线约束是：绝不能在修改代码语义的同时，把生产层面的活儿也悄悄干了。如果语义发生了改变，那就必须走一遍独立的准入流程，而不能把这当成敲代码时顺手为之的“副产品”。

## 执行者 (Worker)

Worker 是具体干活的角色，负责：
- 严格执行单一已准入的 Packet。
- 只读取 `allowed_reads` 中允许查阅的范围。
- 只修改 `allowed_writes` 中允许改动的代码。
- 一旦抵达 Packet 规定的止损线（Stop line），必须立即停手。

Worker 最核心的底线约束是：严禁擅自扩张归属域。如果发现在干活时必须触碰到 Packet 划定域之外的代码，Worker 必须立刻停下来，回头找 Manager 重新划定 Packet 的范围。

此外，Worker 绝不能私自削弱安全报错（Fail-closed）机制。如果 Worker 为了显得“智能贴心”而私自加了一个 Fallback 来掩盖某项合同校验的失败，那它就犯了 `placeholder_success`（占位式成功）的禁忌。

## 审计者 (Auditor)

Auditor 是整套体系中最容易被轻视的角色。**在典型的 AI 工作流中，写出代码的那个循环，往往也就是审查那段代码的循环；这种做法的弊端早已臭名昭著：这套循环自带的认知盲点，会轻而易举地逃过它自己的审查。**

在 `manager_worker_auditor` 模式下，Auditor 在结构上是完全被隔离开的。在目前的宿主实现中，这意味着它必须由另一个独立的 AI 会话（Session），甚至另一家不同的大模型厂商来扮演。

Auditor 负责：
- 执行结构性的审查。
- 揪出设计漂移。
- 对全部四个闭合维度进行严密核验。
- 当 Packet 触及 Spec / Authority / Redesign 等敏感表面时，提供“实现前”的权威收敛证据。

Auditor **绝不能**含糊其辞地把缺失的范围推脱给未来。如果审计查出了缺漏，那就必须毫不留情地点名；“以后会有人修的”绝不配作为一项审计裁定。

Auditor **绝不能**在审计过程中夹带私货去修改权威配置或实现代码。审计行为必须是纯只读的。

Auditor 也**无权**决定语义是否通过，或是 Packet 能否准入。这些权力统统属于 Manager。Auditor 的输出仅仅是“候选证据（Candidate evidence）”；Manager 必须在将工作分派落地之前，先把这份审计证据登记在案。

## 为什么要坚持这种分离？

如果 Manager、Worker、Auditor 坍缩融合进了同一个循环里：

| 病态现象 | 发生了什么 |
| --- | --- |
| 既当裁判又当运动员 | 这个循环天生的认知盲点将被完美保留下来 |
| 范围悄然膨胀 | 由于缺乏独立关口，Worker 会不知不觉地把手伸得越来越长 |
| 标准变软 | 审计的标准会不自觉地向 Worker 实际产出的现实妥协 |
| 漂移被常态化 | 反复出现的错误模式会被大家见怪不怪地认为是“挺好的” |

当它们被严格分离时：

| 机制 | 带来了什么 |
| --- | --- |
| 独立的审计 | 拥有了不同的盲点分布；一个循环没看出来的坑，另一个循环能敏锐地抓住 |
| 极其刚性的范围边界 | Worker 被冻结的 Packet 死死锁住；Manager 想要调整范围，唯一的办法是发一个全新的 Packet |
| 保全评审标准 | Auditor 的标准高高在上，绝不会向 Worker 粗糙的产出低头 |
| 揪出漂移行为 | 那些屡教不改的反模式会被揪出来并打上标签（反模式目录随之扩充） |

## 权威收敛关口 (Authority Convergence Gate)

一个非常具体的约束场景：当一个 Packet 的类型被标记为 `authority`、`spec`、`redesign` 或 `preflight`，并且引用了 `.nimi/spec/` 目录时，Manager 必须**在把任务分派给 Worker 之前**，先拿到并登记一份 Auditor 给出的 PASS 裁定。

| 步骤 | 拥有者 |
| --- | --- |
| 实现前审计 | Auditor (独立方) |
| 登记裁定结果 | Manager (仅负责记录) |
| 分派 Worker 执行 | Manager (只有在拿到审计 PASS 之后才允许分派 Packet) |

而在代码落地之后，推进到机械相变（Mechanical phase transition）阶段之前，还需要再过一道落地后的判断（Judgement），并且必须同样拿到 PASS。

任何悬而未决的阻塞性发现，都会导致流程彻底中止（Fail closed）。

## 场景案例：为什么用同一个循环来做审查注定会失败？

你正在用 AI 执行一项伤筋动骨的大改动。改完之后，你让这个相同的 AI 去审查它自己刚刚写出的代码。

AI 审查了一番，告诉你一切完美。你非常放心地发布了。一周后，你惊讶地发现这次改动悄悄引入了一个 `legacy_alias`（旧别名残留）反模式，而在当初撰写和审查的时候，这个 AI 压根就没看出来。

这就是结构性坍塌带来的失败。同一个循环在生成代码和审查代码时，它的盲区是完全重合的。AI 在当审查员时并没有变得更粗心；只是它对“什么是正确的做法”有着同一套偏见。

方法论给出的解药是：Auditor 必须是**另一个完全不同的循环**。不同的会话，不同的厂商，不同的宿主。只有这样，Auditor 的盲点才会和 Worker 错开。

## 场景案例：单枪匹马的创业者如何应用 Auditor 模式？

你是一个高度依赖 AI 辅助的独立创业者。你没有一个团队来帮你做结构性的代码审查。你只有你自己，和你的 AI 宿主。

方法论给出了这样的解法：

| 循环 | 扮演的角色 |
| --- | --- |
| 你最主力使用的 AI 会话 | Manager + Worker |
| 一个完全分隔开的 AI 会话（另一家厂商，或者至少另开一个会话） | Auditor |
| 你自己 | 把守最后一道验收大门的关卡 |

你现在使用的，正是一个正规团队才会使用的 `manager_worker_auditor` 模型，只不过你是把 Auditor 的活儿路由给了另一个 AI 会话。无需招募更多的人手，你就完美保留了结构性分离的红利。

这也是这套方法论对于单兵作战的开发者最大的吸引力所在：只需把审计工作路由给另一个 AI 循环，你就能模拟出一个专业团队才具备的评审防错冗余度。

## 场景案例：Manager 断然拒绝一次准入请求

Worker 提交了一个 Packet 申请准入。Manager 逐项进行审核：

- 归属权所有者：清晰。
- 允许读取的范围：已受限。
- 允许修改的范围：已受限。
- 验收恒定式：清晰显式。
- 反向测试：清晰显式。
- 止损线：清晰显式。
- 禁用捷径声明：已完整罗列。

但是：这个 Packet 属于触碰了 Spec 的高风险类型，却并没有附带一份来自 Auditor 的 PASS 记录。Manager 断然拒绝了准入请求。

| 步骤 | 发生了什么 |
| --- | --- |
| Worker 申请准入 | 已提交 |
| Manager 检查关口 | 权威收敛关口未通过 |
| 遭到拒绝 | 准入请求被直接驳回 |
| 后续路径 | 乖乖去跑一遍实现前审计；拿到 PASS 并登记；然后重新提交申请 |

在这里，拒绝是**刚性强制的，没有任何商量的余地**。方法论定死了这条铁律：带有阻塞性问题的记录，只有被毙掉这一种下场。

## 来源依据

- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
