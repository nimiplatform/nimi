# 横向对比 (Comparison)

Nimi Coding 究竟处于你已经熟知的那些工程实践版图中的什么位置？本页将把它与它的“邻居”们挨个排队对比：原生 AI 编程、传统代码评审、DevOps / GitOps 治理、领域驱动设计（DDD），以及敏捷开发（Agile / Scrum）。

## vs. 原生 AI 编程 (例如 Cursor / Copilot / Claude 独立客户端)

| 对比维度 | 原生 AI 编程 | Nimi Coding |
| --- | --- | --- |
| **权威真相源** | 隐式存在，口口相传 | **明确具名 (`.nimi/spec/**`)** |
| **验收标准** | 单一维度（“看起来没报错就行”） | **四个闭合维度框架** |
| **改动范围** | 随心所欲、自由发散 | **受冻结 Packet 约束的严格有界写集** |
| **闭合定义** | 开发者自己觉得“做完了” | **必须提供经得起推敲的结构化闭合证据** |
| **审计循环** | 写代码的 AI 顺便自己审自己 | **由结构性分离的独立 Auditor 进行审计** |
| **工具耦合度** | 深度绑定特定 IDE 或宿主厂商 | **厂商中立，宿主可任意替换** |
| **禁用反模式** | 全靠开发者和模型之间的默契 | **白纸黑字的具名封禁目录** |

原生 AI 编程追求的是**代码生成的极致速度**。而 Nimi Coding 追求的是**“完成状态”的可证明正确性**。

## vs. 传统代码评审 (Code Review)

| 对比维度 | 传统 Code Review | Nimi Coding |
| --- | --- | --- |
| **循环隔离度** | 审查者经常与代码作者在同一个团队循环内 | **在结构上被彻底隔离的独立 Auditor** |
| **输出形式** | Approve (批准) / Request Changes (请求修改) | **死板的机器裁定 (PASS / NEEDS_REVISION / FAIL / OVERFLOW)** |
| **闭合维度** | 单一维度（人觉得代码 OK 就行） | **四大维度（权威 / 语义 / 消费方 / 抗漂移）** |
| **最擅长抓出什么** | 函数级别的局部 Bug，或者代码规范问题 | **架构级的权威漂移、影子真相并行、消费方断层** |
| **审查节奏** | 细碎的、基于每次 PR (Pull Request) | **基于更高逻辑单元的 Wave** |
| **沉淀工件** | PR 里的评论聊天记录 | **冻结的 Packet + 审计记录 + 多维闭合档案** |

传统 Code Review 擅长抓出局部的微观 Bug。Nimi Coding 擅长拦截架构上的宏观结构性漂移。二者不仅不是互相替代的关系，反而是完美的互补。

团队完全可以将 Nimi Coding 嵌**入**现有的 PR 工作流中：用一个 PR 来实现某个 Wave；然后把这个 Wave 产生的审计日志和闭合证据附在这个 PR 里；只有当 Wave 彻底闭合了，代码才允许被 Merge。

## vs. DevOps / GitOps 治理

| 对比维度 | DevOps / GitOps | Nimi Coding |
| --- | --- | --- |
| **治理层面** | 代码的部署部署与基础设施 (Infrastructure-as-code) | **代码改动的业务内涵与规范级意义 (Spec-level meaning)** |
| **回答的核心问题** | “这次代码修改能安全地跑在服务器上吗？” | **“这次修改的业务指向和架构逻辑真的对吗？”** |
| **核心工件** | Pipelines (流水线)、Runbooks (操作手册)、基建清单 | **Topic (主题)、Packet (工作包)、Audit (审计记录)** |
| **必须满足的恒定式** | 构建通过、测试跑通、部署成功 | **权威闭合、语义闭合、消费方闭合、抗漂移闭合** |

DevOps 管的是“代码的分发与部署”。Nimi Coding 管的是这次改动在规范层面上的**意义**——这波改动挪走了哪些真相？归属权现在归谁？哪些坑是被明令禁止踩进去的？

这两者是完美的串联关系。Nimi Coding 挡在 DevOps **之前**。一个改动先在 Nimi Coding 里拿到闭合判决（证明语义和架构是对的），然后再被送上 DevOps 的流水线（证明部署落地是安全的）。

## vs. 领域驱动设计 (DDD / RDD)

| 对比维度 | DDD / RDD | Nimi Coding |
| --- | --- | --- |
| **主要研究对象** | 业务领域的形状和架构 | **那些“试图去改变这个领域状态”的开发工作本身** |
| **核心词汇** | 限界上下文、实体、值对象 | **Topic、Wave、Packet、闭合维度** |
| **静态 vs 动态** | 偏静态（描绘和设计领域的蓝图） | **绝对动态（死死盯住并治理每一次演进领域的开发工作）** |
| **最终产出** | 领域模型 (Domain model) | **一份经得起审计追踪的变更纪律档案** |

DDD 告诉你：“你的限界上下文是 X。” Nimi Coding 告诉你：“你当前这个 Wave 所能触碰的归属域（Owner domain）仅限于 X，而且你必须满足这四个闭合条件才能算干完。”

二者结合可谓天作之合。同时采纳两者的团队将获得：
- 借由 DDD 雕琢出的洁净领域模型；
- 借由 Nimi Coding 打造出的、严密防范 AI 瞎改代码的变更防波堤。

## vs. 敏捷开发 (Agile / Scrum)

| 对比维度 | 敏捷开发 (Agile / Scrum) | Nimi Coding |
| --- | --- | --- |
| **主要研究对象** | 沟通的节奏、交付的频率、团队的阵型 | **架构权威的漂移、AI 辅助编程特有的失败模式** |
| **所属逻辑层** | 流程管理 (Process) | **工程方法论 (Methodology)** |
| **时间切分单位** | Sprint (冲刺周期) | **Topic / Wave (纯粹由逻辑边界驱动)** |
| **输出结论** | 用户故事 (Story) → 变成 Done | **Wave → 在 4 个维度上被判为 Closed** |
| **能防范 AI 导致的设计漂移吗？** | 没有覆盖这类问题（因为敏捷诞生在 AI 写代码之前） | **这正是它的核心使命** |

敏捷开发和 Scrum 管的是团队的节奏和与利益相关方的沟通。它们对“权威漂移”、“并行影子真相”以及“AI 导致的伪闭合”完全保持沉默（因为这套体系发明的时候，连 AI 编程的影子都没有）。

Nimi Coding 则对沟通节奏保持沉默（那是另一个逻辑层的事）。它们之间没有任何冲突；它们生活在不同的管理维度，完全可以和谐共处。

## Nimi Coding 的差异化优势到底在哪？ (Differentiation Summary)

| 独门绝技 | 带来了什么颠覆性体验 |
| --- | --- |
| 规范先行的权威观 (Spec-first authority) | 真相被牢牢钉死在 `.nimi/spec/**` 目录下，而不是散落在 PR 描述或随风消逝的聊天记录里。 |
| 四个闭合框架 (Four-closure framework) | “干完”不再是一句话的事，而是必须同时通过四个硬性维度的拷问。 |
| 独立的审计员 (Independent auditor) | 审查结论来自于一个在结构上完全隔离开的独立循环，绝不是让代码原作者自己审自己。 |
| 禁用捷径目录 (Forbidden-shortcuts catalog) | 那些糟糕的反模式被白纸黑字地定了罪，并在 Packet 里发誓绝不触碰。 |
| 宿主无关边界 (Host-agnostic boundary) | 你可以今天用这家模型，明天换那家厂商，而方法论的规则连一个字都不用改。 |
| 处处贯彻安全报错 (Fail-closed everywhere) | 只要查不到权威出处，系统宁可报错罢工，也绝不让 AI 随口编造输出。 |
| 全局统一的世界观 | 从 Topic / Wave / Packet 到预检、审计、收尾，构成了一套严密的逻辑闭环，而不是扔给你一堆零散的配置模板。 |

## 场景案例：同时采用 DDD 和 Nimi Coding

某团队的仓库已经严格按照 DDD 进行了分层设计。现在他们想引入 AI 来提效，但极其害怕 AI 会把原本干净的代码架构搞成一锅粥。

1. **保留 DDD 领域模型**：限界上下文、实体、值对象全部雷打不动。
2. **用 Nimi Coding 为 AI 改代码套上缰绳**：当 AI 参与任何代码变动时，必须老老实实走 Topic / Wave / Packet 的纪律流程。
3. **精准投射**：在配置 Packet 时，直接将每一次 AI 改动的归属域（Owner domain），对齐到 DDD 中的那个限界上下文上。
4. **闭合维度发挥作用**：“AI 的这波改动越界踩进别人的上下文了吗？” —— 这个 DDD 最担心的问题，将由 Nimi Coding 的结构化审计在收尾阶段冷酷地进行拦截。

DDD 负责描绘蓝图；Nimi Coding 负责拿枪顶着执行者的脑袋，确保施工时绝不偏离这张蓝图。

## 场景案例：在保留 Code Review 的同时引入 Nimi Coding

某大型组织的代码审查极为严苛。现在他们想引入 AI 工具，并打算接入 Nimi Coding，同时不想丢掉传统的 Code Review。

1. **Code Review 照常进行**：依然在每一个 PR 里去抓局部的 Bug、纠正代码风格。
2. **Nimi Coding 包裹住 PR**：每一个 PR 都必须承载并实现一个 Wave；在这个 PR 提交时，必须把这个 Wave 产出的审计报告和收尾工件一并挂在上面。
3. **审查工作被彻底拆分**：传统的 Reviewer 看人工代码；而审计工作，则交由另一个独立的 AI 会话（或者另一家厂商）去完成。Reviewer 最终只需要翻阅审计报告。
4. **两道闸门同时落下**：“这段代码能跑吗？”（这是 Code Review 管的）；“这个 Wave 在四个闭合维度上都结案了吗？”（这是 Nimi Coding 管的）。

互补的两道大门同时落下，将捕捉到任何一道单独闸门都会漏掉的隐性灾难。

## Nimi Coding 不适合用在哪里？

| 场景 | 为什么不适合？ |
| --- | --- |
| 微小、低风险的日常修补 | Topic 带来的治理成本是真实存在的。适用性规则里明确写了：杀鸡不用牛刀，微小的改动不需要上 Topic 纪律。 |
| 一次性的临时脚本 | 为了写个阅后即焚的脚本去建 Wave 和 Packet，纯属高射炮打蚊子。 |
| 压根没有 AI 参与的传统老仓库 | 这套方法论是专门为了应对“AI 生成代码时的特有失败模式”而发明的。如果根本不用 AI，那传统的工程卫生习惯已经足够用了。 |

这套方法论对自己的**适用边界**有着极其清醒的认知——它专为高风险任务、涉及架构权威变动的开发、复杂的系统修复，以及长周期的多波次迭代而生。硬把它套在芝麻绿豆大的小需求上，只会平白无故地增加成本，而收不到任何维度的闭合红利。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
