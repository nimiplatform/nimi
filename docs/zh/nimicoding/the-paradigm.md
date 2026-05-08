# 核心范式

Nimi Coding 不仅仅是一份检查清单（checklist）或是一套工作流库，它代表了 **AI 辅助开发的一种全新范式**。本页将深入探讨它之所以被称为“范式”的核心原因。

## 传统开发工具的核心假设

无论是代码评审（Code Review）、自动化测试、类型检查，还是 Linter 和 CI 工具，它们都基于一个共同的假设：**捕捉到的错误通常是局部的，且直接显现在代码中**。一个 Bug 往往存在于某个函数内；一次类型不匹配发生在接口边界；而测试失败则是由于某项行为断言未被满足。

这些工具之所以卓有成效，是因为开发者的意图与其产出的代码之间保持着紧密的耦合。如果开发者想要实现 X 却误写成了 Y，代码评审和测试通常能迅速发现这一偏差（Gap）。

## AI 编程打破了什么？

在 AI 辅助实现的过程中，大模型生成的产物往往呈现出一种迷惑性：

- 代码能够成功编译；
- 能够通过现有的所有测试用例；
- 在审计者看来逻辑通顺且合理；
- **但其在架构权威、影响范围、语义内涵或产品逻辑上，依然可能是错误的。**

Nimi Coding 方法论旨在识别并捕捉以下几种典型的失败形态：

| 失败形态 | 发生机制 |
| --- | --- |
| 旧文档锚定 | AI 遵循了一份看似权威、实则已与当前 Spec（规范）发生漂移的旧文档。 |
| 隐性范围扩张 | AI 在修改某个文件的过程中，“顺便”改动了相邻的逻辑，导致所有权（Ownership）在无声无息中发生了偏移。 |
| 自圆其说式生成 | 在缺失权威真相源时，AI 会编造出一个逻辑严密、足以乱真的答案。 |
| 旧路径保留 | AI 将新功能与旧逻辑并列，美其名曰“安全迁移”，而原本的旧路径本应被彻底移除。 |
| Build-pass的“假闭合” | 因为测试用例跑通了就标记任务完成，而忽略了在用户侧的行为依然是错误的。 |
| 封闭的功能面被错误打开| 以“修复小Bug”为名，对已经闭合的功能面进行二次修改，导致原本稳固的权威闭环发生偏移。 |
| 伪成功 | 类型化合同的校验失败被一个简单的 Fallback（回退机制）掩盖，系统返回了“某个值”而不是安全地报错中断。 |
| 上下文门禁漂移 | 为了节省 AI 的上下文（Context）额度，原本用于保障审计的门禁被过度压缩的文件或浅显的摘要绕过，导致审计所需的证据丢失。 |

这些问题在传统意义上并不完全属于 Bug，而属于**闭合失败（Closure Failures）**——即工作在闭合条件未成立的状态下被宣布做完了。

其中，“上下文门禁漂移”在 AI 原生工作流中尤为隐蔽。为了维持 AI 上下文的可用性，开发者可能会过度精简文件或汇总证据。Nimi Coding 将此类行为视为“漂移”而非成功：正确的做法是保持职责清晰、边界明确的源文件和类型化证据，而不是为了通过门禁而牺牲审计的可追溯性。

## 为何称其为“范式”而非“清单”？

“清单”是告诉你“记得去做这些事”；而“范式”是**一套改变你如何看待和定义工作的思维框架**。

Nimi Coding 并不只是增加了一堆待办事项，而是建立了一套**显式的契约机制：在工作开始前声明闭合条件，在工作结束后提供核验依据。**

以下四项核心机制使其成为一种新范式：

1. **权威具名化 ：** 任何改动都必须明确其真相来源（`.nimi/spec/**`）、归属领域（Owner）以及工作类型（对齐/重构/规范变更等）。
2. **执行被 packet 化：** 开发工作受限于一份“冻结”的工作包（Packet）。在动手前，Packet 需明确读取范围、写入边界、验收恒定式、反向测试、止损红线及重开条件。Worker 不得擅自扩张工作范围。
3. **多维闭合：** 权威闭合、语义闭合、消费方闭合与抗漂移闭合是四个独立的关口。仅达成其中三项并不代表 Wave 的终结。
4. **角色分离与独立审计：** 管理者（Manager）负责准入与终判；执行者（Worker）负责 Packet 的产出；审计者（Auditor）进行结构性评审与漂移检测，且不具备修改代码或准入的权限。

这种组合构成了一套严密的范式：在这个体系中，AI 生成的“看起来不错”的产物，如果没有独立于生成链路之外的外部证据支撑，永远无法升格为“已完成（Done）”。

## 案例分析：代码评审（CR）无法捕捉的失败

场景：开发者要求 AI “在用户资料中新增一个字段”。AI 完成了代码编写，测试通过，CR 批准。

**然而，CR 和测试通常无法回答以下深层问题：**
- 这次改动是否需要更新规范的用户身份合同（Identity Contract），还是仅仅是一个纯展示字段？
- 新字段是否与某个本应被删除的旧迁移逻辑产生了冲突？
- 是否有其他表面（如其他 App 或文档）在暗示该字段已存在，而实际上却未生效？
- 该字段是否留下了可供审计的痕迹，还是在审计视线之外被“偷运”进代码库的？

Nimi Coding 通过结构化机制让这些问题变得**可回答**：Packet 限制了权威域，反向测试（Negative Tests）检查 CR 盲区，多维闭合则迫使我们思考：“消费方现在使用的接口是否正确？”

## 案例分析：为什么“调优 Prompt”解决不了根本问题？

面对 AI 出错，最直觉的修补方案是“写出更好的 Prompt”。但这仅是治标，而非治本。它没有解决结构性问题：即**评审产出的循环（Review Loop）与产出内容的循环（Generation Loop）往往是同一个。**

Nimi Coding 通过**角色分离（Role Separation）**从架构层面解决了这一问题。审计者角色（Auditor）**不在同一个循环内**。在 `manager_worker_auditor` 模式下，审计工作来自一个结构上完全独立的循环：可能是另一个 AI 会话、另一家模型厂商，甚至是不同的宿主环境。

再精妙的 Prompt 也无法取代这种结构的分离，而范式本身提供这种分离。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
