# 提示词服务

Cognition 提示词服务是"提示词如何被组装"的权威。它从 kernel（核心真相）和 advisory 产物（记忆、知识、技能）取材，产出强类型的提示词上下文，并在不同通道之间严格隔离。

## 三种格式方法

| 方法 | 提供什么 |
| --- | --- |
| `FormatCore` | 仅 kernel 真相：agent kernel 加 world kernel |
| `FormatAdvisory` | 已校验的 advisory 产物：记忆、知识、技能 |
| `FormatAll` | 在准入序列下组合 core 与 advisory |

三条通道刻意分开。`FormatCore` 不能塞 advisory 内容；`FormatAdvisory` 不能塞 kernel 内容；`FormatAll` 是唯一的准入组合。

## 为什么要做通道隔离

不做隔离时，提示词组装会把"我是谁"的身份上下文与"我记得什么"的召回上下文悄悄混在一起，模型分辨不出来。

做了隔离后：

- `FormatCore` 是**身份上下文**：变化缓慢的 kernel 真相。
- `FormatAdvisory` 是**召回上下文**：本回合相关的记忆 / 知识 / 技能。
- working state 与例程证据**按设计被排除**在提示词之外。

模型看到的提示词每个段落都有强类型，没有东西能偷溜进来。

## working state 不会进提示词

working state 是**暂态认知支架**：Agent 的中间笔记、例程的记账等。它不是持久真相，**永远不会**作为提示词上下文提供。

如果允许 working state 进提示词，提示词就会塞进任意脚手架。这道硬边界保证提示词干净。

## 提示词通道

通道在 `tables/prompt-serving-lanes.yaml` 里准入。每条通道声明：

| 字段 | 用途 |
| --- | --- |
| 服务序 | 通道在 `FormatAll` 中的位置 |
| 准入产物族 | 通道可读取哪些产物族 |
| 准入输入 | 通道接受什么输入 |
| 派生视图来源 | 通道背后是哪个服务侧派生视图 |
| 禁入输入 | 哪些输入被显式排除 |

想知道某条通道产出什么形态，去查表，不在文档散文里找。

## 场景：Agent 一次回合的完整提示词

Agent 准备产出一次回合。

1. **调用 `FormatAll`**：Cognition 提示词服务组装完整提示词。
2. **core 通道**：agent kernel 加 world kernel——变化缓慢的身份。
3. **advisory 通道**：记忆召回、知识查询、技能 advisory——都已校验。
4. **按准入序排列**：通道按准入序出现。
5. **排除 working state**：暂态支架不会泄漏。
6. **结果交给 Brain**：模型看到的是带强类型分段的提示词。

提示词把"身份"与"召回"分开标注，模型才区分得出二者；通道隔离正是这件事的保证。

## 场景：App 想从提示词偷运内容

某个能访问 Agent 表面的 App 想偷塞额外上下文进提示词。

1. **App 准备内容**，希望进入提示词。
2. **提交到准入通道**：通道按其准入形态校验输入。
3. **禁入输入被拒**：working state、例程证据等禁入输入校验失败。
4. **被允许的输入按通道形态准入**，停留在该通道的强类型形态内。

App 没法借提示词组装夹带 working state——通道校验就是那道闸口。

## 场景：审计员还原"模型看到了什么"

审计员想精确还原某次回合时 Agent 的提示词上下文。

1. **按 trace id 找到这一回合**。
2. **读取提示词组合记录**：Cognition 记录了这次回合每条通道产出了什么。
3. **还原**：审计员看到 core 通道内容、advisory 通道内容与排序。
4. **没有暗藏内容**：模型输入里出现的东西必然在记录的组合里。

通道隔离让这种还原是结构化的。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| 提示词组合 | Cognition 提示词服务 |
| 通道语义 | `tables/prompt-serving-lanes.yaml` |
| Kernel 真相来源 | Cognition 的 kernel |
| advisory 输入 | 准入的记忆 / 知识 / 技能服务 |
| working state | 按设计被排除 |

## 来源依据

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
