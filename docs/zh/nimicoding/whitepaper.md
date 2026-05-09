# Nimi Coding 白皮书

Nimi Coding 将 AI 辅助实现视为一项承载权威的工作。核心主张是：在复杂项目中应用 AI 辅助编程，只有在正式接受产出之前，明确界定权威来源、影响范围、执行工作包 (Packet)、审计关口以及收尾标准，才能取得成功。

本白皮书旨在论证这一主张，并详细阐述该方法论旨在应对的各种失败模式。

## 传统 AI 编程模式的局限性

小规模代码修改时，AI 助手可以读取少量文件、修改代码、运行测试并完成任务。但面对复杂项目时，这种模式往往会失效。AI 助手可能会：

- 遵循看似权威但实际上已过时的文档；
- 自行推断并实现未经正式确认的产品逻辑；
- 保留已被废弃的兼容性路径，仅仅因为它们仍能通过编译；
- 仅仅因为构建成功就宣告任务完成，忽视用户侧的实际行为错误；
- 产出的结果在某一个闭合维度上看似完整，但在另一个维度上却存在缺陷。

在 AI 的单次执行中，这些问题难以察觉。当时每个步骤看起来都是正确的。

## Nimi Coding 核心模型

Nimi Coding 将开发过程分离为五个独立的关注点：

| 关注点 | 核心解决的问题 |
| --- | --- |
| **权威 (Authority)** | 事实的真相位于何处？ |
| **工作包 (Packet)** | 执行者被允许读取什么、修改什么以及声明什么？ |
| **波次 (Wave)** | 当前正在闭合哪一个所有权领域 (Owner domain)？ |
| **审计 (Audit)** | 存在哪些证据可以证明工作没有发生漂移？ |
| **收尾 (Closeout)** | 为什么该任务在权威、语义、消费方和抗漂移这四个维度上均已彻底完成？ |

该模型并非旨在消除迭代，而是使得每一次迭代都具备可审计性。

## 四大闭合维度

每个波次 (Wave) 必须同时满足以下四个维度的要求，才被视为真正闭合：

- **权威闭合 (Authority closure)** —— 改动严格限制在已准入的范围内，未发生任何隐性的范围扩张。
- **语义闭合 (Semantic closure)** —— 产出的代码准确表达了预期的业务逻辑和契约含义。
- **消费方闭合 (Consumer closure)** —— 交付成果切实满足了调用系统或实际读者的需求。
- **抗漂移闭合 (Drift-resistance closure)** —— 改动未留下任何可能导致未来设计发生倒退或漂移的隐患。

大多数“看似完成实则不然”的失败案例，均可归结为在满足某一维度的同时，忽略了另一个维度。例如，对文档的重写可能在权威上闭合（未偏离规范）且在语义上闭合（声明准确），但在消费方维度上却失败了，因为最终生成的文档机器感过重，导致人类读者无法有效阅读。

## 案例分析：一个处于挂起 (Pending) 状态的 Topic

我们当前正在处理的公共文档修复任务，是一个极佳的案例说明：

1. 在上一个 Topic 中，系统尝试基于源码事实来重构公共文档。当时权威闭合处理得非常严谨：没有发生规范漂移，所有的公开声明均具备源码依据。
2. 语义闭合同样达标：文本准确无误地描述了规范契约。
3. 然而，消费方闭合失败了：用户反馈生成的文档读起来像审计报告，缺乏可读性。
4. 抗漂移闭合依赖于人类用户的最终验收，而这一验收未能通过。
5. 因此，该 Topic 被置于挂起 (Pending) 状态，而非直接标记为已完成。

正是这种四维闭合模型，捕捉到了那些单纯依靠“构建通过”规则所无法发现的深层缺陷。

## 为何该机制并非繁文缛节

Topic 的流程和结构要求在初期可能显得较为繁重。但这种投入是必要的，因为 AI 极其擅长生成“看似合理实则错误”的输出。在传统的代码库中，代码审查和测试是主要的防线。而在 AI 辅助的环境下，AI 生成的产物可以轻易通过这两道防线，但在架构权威、作用范围或消费方适用性上却存在根本性错误。

Nimi Coding 并非旨在取代传统的代码审查。它旨在增加一道结构化的审计门槛，专门用于拦截那些单纯依赖代码审查无法防范的失败模式。

## 消费方闭合的重要性

之所以存在上述关于“修复人类可读文档”的 Topic，正是因为之前的文档重写虽然通过了所有机器审查，却未能满足人类消费者的实际需求。这正是 Nimi Coding 致力于暴露的典型问题：一项任务即便拥有权威依据、Lint 检查通过、构建成功，依然可能无法满足最终消费者的预期。

当发生此类情况时，正确的应对策略是保持该 Topic 的挂起 (Pending) 状态，并准入一个后续的 Wave 来专门解决该问题，而非勉强宣布任务完成。

## 参考来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
