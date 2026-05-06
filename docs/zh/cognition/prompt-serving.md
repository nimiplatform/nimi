# Prompt 服务

Cognition Prompt 服务是 prompt **怎么**为模型组合的权威。它从 kernel（核心真相）和建议工件（记忆、知识、技能）取材，产出类型化 prompt 上下文，道之间严格切分。

## 三个 Format 方法

| 方法 | 服务什么 |
| --- | --- |
| `FormatCore` | 仅 kernel 真相 — Agent kernel + 世界 kernel |
| `FormatAdvisory` | 已校验建议工件 — 记忆、知识、技能 |
| `FormatAll` | 在准入排序下组合的 core + advisory |

三道有意分开。`FormatCore` **不能**纳建议内容；`FormatAdvisory` **不能**纳 kernel 内容；`FormatAll` 是准入组合。

## 为什么道分开

没道分开，prompt 拼装就会静默把身份上下文跟回忆上下文混在一起。模型分不出「我是谁」、「我记得什么」、「我现在在干什么」。

道分开后：

- `FormatCore` 是**身份上下文** — 变化缓慢的 kernel 真相。
- `FormatAdvisory` 是**回忆上下文** — Agent 跟本轮相关的记忆 / 知识 / 技能 bundle。
- Working state 与例程证据按设计**从 prompt 服务排除**。

模型拿到的 prompt 有显式类型化分段；没有东西偷溜进去。

## Working state **不**到 prompt

Working state 是**瞬时认知脚手架** — Agent 的中间笔记、例程簿记等。它**不是**持久真相，也**永不**作为 prompt 上下文服务。

如果 working state 能漏进 prompt，prompt 就会获取任意脚手架。硬边界让 prompt 保持干净。

## Prompt 道

道在 `tables/prompt-serving-lanes.yaml` 准入。每道声明：

| 字段 | 用途 |
| --- | --- |
| 服务排序 | 道在 `FormatAll` 里出现的位置 |
| 准入家族 | 这道读哪些工件家族 |
| 准入输入 | 这道接受什么输入 |
| 派生视图来源 | 哪份服务派生视图支撑这道 |
| 禁止输入 | 显式排除什么 |

想知道「这道产出什么形状」的读者去查表，不看文档散文。

## 阅读场景：Agent 一轮 compose 完整 prompt

某 Agent 即将产出一轮。

1. **`FormatAll` 调用。** Cognition 的 prompt 服务 compose 完整 prompt。
2. **Core 道。** Agent kernel + 世界 kernel — 缓变身份。
3. **Advisory 道。** 记忆回忆、知识查询、技能 bundle — 全是已校验建议。
4. **准入服务排序。** 道按准入排序出现。
5. **Working state 排除。** 瞬时脚手架**不**漏。
6. **结果交给 Brain。** 模型看到带类型化分段的类型化 prompt。

模型分不出「这是身份」「这是回忆」 — 除非 prompt 区分它们 — 而道分开正是这件事。

## 阅读场景：Mod 试图通过 prompt 注入

某有 Agent 面访问的 mod 试图通过 prompt 拼装夹带额外上下文。

1. **Mod 构造意图内容。** 想让它进 prompt。
2. **提交到准入道。** 道对照准入形状校验输入。
3. **禁止输入被拒。** Working state、例程证据或别的禁止输入校验失败。
4. **允许输入在道下准入。** 留在那道的类型化形状里。

Mod **无法**通过 prompt 拼装夹带 working state。道校验是闸门。

## 阅读场景：审计员问「模型当时看到了什么」

某审计员想精确重建某次轮次时 Agent 拿到的 prompt 上下文。

1. **按 trace id 定位轮次。**
2. **读 prompt 组合。** Cognition 记下这次轮次哪些道产出了什么内容。
3. **重建。** 审计员看到 core 道内容、advisory 道内容、排序。
4. **没隐藏内容。** 模型输入里的东西全在记下的组合里。

道分开让这种重建在结构上可达成。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| Prompt 组合 | Cognition Prompt 服务 |
| 道语义 | `tables/prompt-serving-lanes.yaml` |
| Kernel 真相来源 | Cognition kernel |
| 建议输入 | 记忆 / 知识 / 技能服务（准入） |
| Working state | 设计上排除 |

## 来源

- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/skill-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/skill-service-contract.md)
