# Nimi Coding 白皮书

Nimi Coding 将 AI 辅助实现视为一项承载权威的工作。核心主张是：复杂 AI 编码要成功，必须在接受产出之前明确权威来源、影响范围、执行 packet、审计关口和收尾标准。

本页论证这条主张，并说明这套方法论处理哪些失败模式。

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
| **权威** | 事实的真相位于何处？ |
| **packet** | 执行者被允许读取什么、修改什么以及声明什么？ |
| **wave** | 当前正在闭合哪一个所有权领域？ |
| **审计** | 存在哪些证据可以证明工作没有发生漂移？ |
| **收尾** | 为什么该任务在权威、语义、消费方和抗漂移这四个维度上均已彻底完成？ |

这个模型不消灭迭代。它让每一次迭代都能被审计。

## 四大闭合维度

每个 wave 必须同时满足以下四个维度，才算真正闭合：

- **权威闭合** —— 改动严格限制在已准入的范围内，未发生任何隐性的范围扩张。
- **语义闭合** —— 产出的代码准确表达了预期的业务逻辑和契约含义。
- **消费方闭合** —— 交付成果切实满足了调用系统或实际读者的需求。
- **抗漂移闭合** —— 改动未留下任何可能导致未来设计发生倒退或漂移的隐患。

大多数“看似完成实则不然”的失败，都来自某个维度通过、另一个维度失败。例如，文档重写可能在权威上闭合（未偏离规范），语义上也闭合（声明准确），但消费方维度失败，因为最终文档不像公开文档，读者无法建立清晰模型。

## 案例分析：一个处于挂起状态的 topic

我们当前正在处理的公共文档修复任务，是一个极佳的案例说明：

1. 在上一个 topic 中，系统尝试基于源码事实来重构公共文档。当时权威闭合处理得非常严谨：没有发生规范漂移，所有的公开声明均具备源码依据。
2. 语义闭合同样达标：文本准确无误地描述了规范契约。
3. 然而，消费方闭合失败了：用户反馈生成的文档读起来像审计报告，缺乏可读性。
4. 抗漂移闭合依赖于人类用户的最终验收，而这一验收未能通过。
5. 因此，该 topic 被置于挂起状态，而非直接标记为已完成。

正是这种四维闭合模型，捕捉到了那些单纯依靠“构建通过”规则所无法发现的深层缺陷。

## 为何该机制并非繁文缛节

topic 的流程和结构要求在初期可能显得较重。但这种投入是必要的，因为 AI 极其擅长生成“看似合理实则错误”的输出。在传统的代码库中，代码审查和测试是主要防线。而在 AI 辅助的环境下，AI 生成的产物可以轻易通过这两道防线，却在架构权威、作用范围或消费方适用性上出错。

Nimi Coding 不取代传统代码审查。它增加一道结构化审计关卡，用来拦截代码审查单独防不住的失败模式。

## 消费方闭合的重要性

之所以存在上述关于“修复人类可读文档”的 topic，正是因为之前的文档重写虽然通过了所有机器审查，却未能满足人类消费者的实际需求。这正是 Nimi Coding 要暴露的典型问题：一项任务即便拥有权威依据、Lint 检查通过、构建成功，依然可能无法满足最终消费者的预期。

当发生此类情况时，正确的应对策略是保持该 topic 的挂起状态，并准入一个后续 wave 专门解决这个缺口，而非勉强宣布任务完成。

## 来源依据

- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
