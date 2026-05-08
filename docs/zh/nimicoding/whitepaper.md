# Nimi Coding 白皮书

在 Nimi Coding 的视野中，AI 辅助开发本质上是一项**承载架构权威**的工作，而不仅仅是代码生成。我们的核心主张是：只有预先显式地定义好权威归属、影响范围、执行步骤（Packet）、结果审计以及闭合标准，AI 协作开发才能真正高效且准确。

本白皮书旨在阐述这一主张的理论依据，并展示其旨在解决的各种核心失败形态。

## 传统 AI 协作为何会失灵？

对于简单的改动，AI 助手通常表现良好：读取文件、修改代码、跑通测试。但一旦项目规模和复杂度跨越某个临界点，这种模式就会失效。常见的病态表现包括：

- 遵循了一份看起来权威、实则已过时的文档。
- 根据逻辑推断补全了从未经过准入的产品逻辑。
- 留下了旧的兼容路径，仅仅因为它仍然能编译通过。
- 因为 Build 成功就把任务关闭，而忽略了用户侧的真实结果是错误的。
- 交付产物在某个闭合维度上看似完整，但在另一个维度上（如消费方体验）完全无法通过审计。

这些失败有一个共同特征：**在 AI 自身的执行循环内部，这些问题极难被察觉。** 独立来看，每一步都像是成功完成。

---

## Nimi Coding 核心模型

Nimi Coding 将开发过程拆解为五个关注点：

| 关注点 | 核心回答 |
| --- | --- |
| **权威 (Authority)** | 唯一真相的源头位于何处？ |
| **Packet** | 执行者允许读取什么、修改什么以及声明什么？ |
| **Wave** | 当前正在尝试闭合哪一个owner域？ |
| **审计 (Audit)** | 有什么证据能证明这次任务没有发生漂移？ |
| **Closeout** | 为何该任务在权威、语义、消费方、抗漂移这四个维度上都已收口？ |

---
这个Model并没有移除迭代，而是让迭代本身可审计。

## 四个闭合维度

在 Nimi Coding 中，一个 Wave 必须同时满足以下四维要求才算真正闭合：

1. **权威闭合**：确保改动落在已准入的范围内，没有悄悄越界。
2. **语义闭合**：确保代码真实表达了预期的业务逻辑。
3. **消费方闭合**：确保产品真正服务于使用它的人或者系统。
4. **抗漂移闭合**：确保没有留下任何可能导致漂移再次发生的隐患。。

“看起来做完、实际未做完”的这一类失败，都能对应到其中“某一维度未通过，但其他维度通过”的情况。例如，一次文档重写可能通过了权威审计（Spec 未动）和语义审计（叙述准确），但如果读起来由于机器味太重而导致用户无法使用，那么它就属于**消费方闭合失败**。

---

## 为什么这套流程不是“官僚主义”？

Topic 流程初看可能显得繁琐，但它是应对 AI 特性的必要投资。AI 助手非常擅长交出一种“看似合理、实则有误”的产物。在传统开发中，Code Review 和测试是主要防线；但 AI 有能力生成能越过这两道防线，却在架构权威或产品逻辑上完全错误的产物。

Nimi Coding 并不取代 Code Review，而是增加了几道 Code Review 自身无法捕捉的硬关口。

## 消费方闭合的重要性

正如我们正在处理的“人类可读文档”修复任务所揭示的：一项工作可以做到真相源锚定准确、代码风格洁净、构建流程绿灯，但仍然无法满足真实用户的消费需求。

遇到这种情况，正确的做法是**让 Topic 维持在 Pending 状态**，并打开一个后续 Wave来处理，而不是宣布任务已完成。

---

## 来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
