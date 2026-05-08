# 角色分离

三个角色，严格分离。auditor **不是 worker 换一顶帽子**——这一条是方法论在执行层最具特色的硬规则。

## 三个角色

| 角色 | 负责什么 | 不允许做什么 |
| --- | --- | --- |
| Manager | wave 图、packet 准入、manager 判定、closeout 同步 | 一边改语义，一边偷偷把生产范围实施掉 |
| Worker | 一份已准入的 packet，在边界内的写入 | 扩大所有权域；削弱 fail-closed 规则 |
| Auditor | 结构性复核、漂移识别、四闭合核验、当 packet 触及规范 / 权威 / 重设计表面时给出实施前权威收敛证据 | 把缺失影响范围悄悄记成"以后再办"；审计期间改写权威或实现；替 manager 做语义接受或 packet 准入决定 |

不允许做的事写得很显式，原因是它们正是每个角色最容易越界的方向。

## Manager

manager 是这样的角色：

- 决定准入哪个 wave。
- 冻结对应 wave 的 packet。
- 记录审计结果。
- 决定 wave 是进入 closeout、退回修订，还是准入续作。
- 记录 topic 级别的 closeout 决定。

最严格的执行模式（`manager_worker_auditor`）下，manager **不写生产代码**。在 `inline_manager_worker` 模式（仅限低风险工作）下，manager 与 worker 可以是同一个回路。

manager 的关键约束：不能在改语义的同时偷偷实施生产范围。语义变更必须独立准入，不能作为执行的副作用顺带出现。

## Worker

worker 是这样的角色：

- 执行一份已准入的 packet。
- 只读 `allowed_reads` 准许的内容。
- 只写 `allowed_writes` 准许的内容。
- 抵达 packet 停止线即停。

worker 的关键约束：不扩大所有权域。如果工作需要触及 packet 所有权域之外的表面，worker 必须停下，等待 manager 重新划定范围、重新冻结 packet。

worker 也不可以削弱 fail-closed 规则。一个"出于好意"为契约失败补一层回退的 worker，已经引入了 `placeholder_success`。

## Auditor

auditor 是最容易被低估的角色。**典型 AI 工作流里，写代码的回路同时也复核自己的代码，已知的失败模式是：这个回路的盲区在复核时同样存在。**

`manager_worker_auditor` 模式下的 auditor 与产出回路结构上独立。在当前的宿主实现中，这意味着另一个 AI 会话或另一家厂商。

auditor 负责：

- 结构性复核。
- 漂移识别。
- 四个维度的闭合核验。
- 当 packet 触及规范 / 权威 / 重设计表面时，给出实施前的权威收敛证据。

auditor **不会**把缺失的影响范围悄悄登记为"以后再办"。审计若发现缺口，必须显式命名；"将来有人会补"不是审计判定。

auditor **不会**在审计期间改写权威或实现。审计是只读的。

auditor **不会**替 manager 决定语义接受或 packet 准入。这两件事归 manager。auditor 的输出只是"候选证据"；manager 需要在派发前记录审计结果。

## 为什么必须分离

如果 manager / worker / auditor 折叠成同一个回路：

| 病理 | 后果 |
| --- | --- |
| 自我复核 | 回路盲区在复核中保留下来 |
| 影响范围蔓延 | worker 静默扩张，因为没有独立的闸门 |
| 软通过 | auditor 的标准滑向 worker 实际产出的水平 |
| 漂移被默许 | 反复出现的反模式被默认为"没事" |

如果它们彼此分离：

| 行为 | 收益 |
| --- | --- |
| 独立审计 | 盲区不重合，一边漏掉的另一边能抓到 |
| 影响范围有硬边界 | worker 受冻结的 packet 约束；manager 重新划界必须出新 packet |
| 标准不会下滑 | auditor 的标准不会向 worker 现实漂移 |
| 漂移被识别 | 反复出现的反模式会被命名（catalog 持续生长） |

## 权威收敛闸门

一个具体场景：当 packet 类型为 `authority`、`spec`、`redesign` 或 `preflight`，并触及 `.nimi/spec/` 时，manager 必须在派发 worker **之前**记录一份 auditor 的 PASS 判定。

| 步骤 | 责任方 |
| --- | --- |
| 实施前审计 | auditor（独立） |
| 记录判定 | manager（仅记录） |
| 派发 worker | manager（审计 PASS 后才能准入 packet） |

实施完成后，进入下一阶段前还需要一次 judgement PASS。

未消解的阻断项 fail closed。

## 场景：为什么"自己审自己"行不通

你正在用 AI 做一项实质改动。你让同一个 AI 自我复核。

AI 复核完成，看着没问题。你交付。一周后发现这次改动引入了一个 `legacy_alias` 反模式，AI 写代码时没识别，AI 复核时也没识别。

这就是结构性失败模式。同一个回路写代码与复核代码时，盲区不会改变。AI 在复核时并不会"更细心"，它脑中"什么算 OK"的模型是同一个。

方法论的应对：auditor 是**另一个回路**。不同会话、不同厂商、不同宿主。它的盲区不一样。

## 场景：单干创业者怎么用 auditor

你是单干创业者，重度依赖 AI。没有团队帮你做结构性复核。你只有自己和 AI 宿主。

方法论的应对：

| 回路 | 角色 |
| --- | --- |
| 你日常在用的 AI 会话 | manager + worker |
| 一个独立的 AI 会话（不同厂商或不同会话） | auditor |
| 你本人 | 最终接受闸门 |

你用的还是 `manager_worker_auditor` 模型，只不过把 auditor 路由到另一个 AI 会话上。结构上的分离仍然成立，并不需要更多人。

这正是方法论给单干创业者的卖点：不靠团队，也能模拟出团队级别的复核冗余，做法是把审计走另一个 AI 回路。

## 场景：manager 拒绝准入

worker 提交一份 packet 申请准入。manager 复核：

- 权威属主：明确。
- 允许的读：有界。
- 允许的写：有界。
- 验收恒定式：显式。
- 负面测试：显式。
- 停止线：显式。
- 禁用反模式：已声明。

但：这份 packet 触及规范，且尚未记录 auditor PASS。manager 拒绝准入。

| 步骤 | 发生什么 |
| --- | --- |
| worker 申请准入 | 已提交 |
| manager 检查闸门 | 权威收敛闸门未满足 |
| 拒绝 | 准入被拒 |
| 后续路径 | 跑实施前审计；记录 PASS；重新申请 |

拒绝**不是可选项**。方法论的硬规则：未消解的阻断项 fail closed。

## Source Basis

- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
