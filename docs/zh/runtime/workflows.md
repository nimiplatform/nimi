# Workflows

工作流是 Runtime 用来跑「不止一轮请求-响应」的 AI 工作的类型化执行图。这页讲工作流模型、类型化节点、工作流状态机、合并策略。

流式细节见 [流式](/zh/runtime/streaming)。非文本 artifact 见 [多模态](/zh/runtime/multimodal)。

## 工作流是什么

工作流是类型化节点构成的 DAG。App 通过组合准入节点种类来构造工作流；Runtime 拥有执行、重试、分支、合并、审计。

| 性质 | 值 |
| --- | --- |
| 形状 | 有向无环图 |
| 节点数 | 3 类共 15 种类型化种类 |
| 重试 | 按节点，准入合同 |
| 分支 | 通过 `CONTROL_BRANCH` 条件化 |
| 合并 | 通过 `CONTROL_MERGE` 配准入策略汇合 |
| 执行 | 内联或外部异步 |

App 不发明执行语义。工作流受准入合同约束；未定义的节点种类 fail-close。

## 15 种节点

| 类别 | 种类 |
| --- | --- |
| AI | `AI_GENERATE`、`AI_STREAM`、`AI_EMBED`、`AI_IMAGE`、`AI_VIDEO`、`AI_TTS`、`AI_STT`、`AI_TTS_CREATE_VOICE`、`AI_TTS_SYNTHESIZE` |
| Transform | `TRANSFORM_EXTRACT`、`TRANSFORM_TEMPLATE`、`TRANSFORM_SCRIPT` |
| Control | `CONTROL_BRANCH`、`CONTROL_MERGE`、`CONTROL_NOOP` |

每种都有类型化输入、类型化输出、准入的重试 / 分支 / 合并语义。种类在 Runtime kernel 准入；新种类需要 kernel 扩展。

## 工作流状态机

| 状态 | 终态？ |
| --- | --- |
| `ACCEPTED` | 否 |
| `QUEUED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `CANCELED` | 是 |
| `SKIPPED` | 是 |

工作流以 `COMPLETED | FAILED | CANCELED | SKIPPED` 之一结束。状态对 App 通过工作流事件流可观测。

## 工作流事件流

工作流跑的过程中，Runtime 发类型化事件：

| 事件 | 触发时机 |
| --- | --- |
| `STARTED` | 工作流进入 `RUNNING` |
| `NODE_STARTED` | 节点开始执行 |
| `NODE_PROGRESS` | 节点发出进度 |
| `NODE_COMPLETED` | 节点完成 |
| `NODE_SKIPPED` | 节点被跳过 |
| `COMPLETED` | 工作流到 `COMPLETED` |
| `FAILED` | 工作流到 `FAILED` |
| `CANCELED` | 工作流到 `CANCELED` |

加上扇出到 Provider 异步任务的节点对应的外部异步变体（见 [多模态](/zh/runtime/multimodal)）。

## 合并策略

多条并行分支在 `CONTROL_MERGE` 节点汇合时，合并策略决定何时满足：

| 策略 | 满足条件 |
| --- | --- |
| `ALL` | 所有上游分支完成 |
| `ANY` | 任意一条上游分支完成 |
| `N_OF_M` | N 条上游分支完成 |

合并策略在工作流构造时声明；Runtime 强制执行。

## 内联与外部异步执行

| 模式 | 何时 |
| --- | --- |
| 内联 | 节点在工作流运行内同步执行 |
| 外部异步 | 节点扇出到 Provider 异步任务或别的长跑外部工作；工作流跟踪外部生命周期 |

外部异步让一个含（比如）长跑视频生成任务的工作流不至于把整个工作流挡住。Provider 异步生命周期（`queued → running → succeeded | failed | expired`）规范化映到工作流状态机。

## ScenarioJob 链接

工作流的 AI 节点路由经 `ScenarioJob` 走统一执行语义。`ScenarioJob` 是任何 AI 请求的共享生命周期：

| 状态 | 终态？ |
| --- | --- |
| `SUBMITTED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是 |
| `FAILED` | 是 |
| `TIMEOUT` | 是 |
| `CANCELED` | 是 |

想要任意 AI 工作的统一句柄的 App 用 `ScenarioJob` 作桥 — 每种模态、每个 Provider、每个工作流节点都扇出到 `ScenarioJob` 生命周期。

## 阅读场景：多步工作流

App 构造一条工作流：

1. 从 PDF 抽文本（`TRANSFORM_EXTRACT`）。
2. 把抽出的文本做 embedding（`AI_EMBED`）。
3. 生成结构化分析（`AI_GENERATE`）。
4. 把分析合成 TTS（`AI_TTS`）。

执行：

1. 工作流进入 `ACCEPTED`。DAG 被校验；节点种类被准入；重试 / 分支 / 合并合同被记下。
2. 工作流搬到 `QUEUED`，再到 `RUNNING`。`STARTED` 事件触发。
3. 节点 1 跑。`NODE_STARTED → NODE_PROGRESS → NODE_COMPLETED`。
4. 节点 2 跑。Embedding 结果是类型化的。
5. 节点 3 跑。结构化输出是类型化的；schema 不通过则节点失败（暂不影响整个工作流）。
6. 节点 4 跑。TTS artifact 按多模态 artifact 合同投递。
7. 工作流到 `COMPLETED`。审计被记下。

任一节点撞合同失败时，工作流终态取决于节点级重试策略。瞬时错误可重试；合同失败 fail-close。

## 阅读场景：分支-合并工作流

App 构造一条工作流：

1. 并行生成三条候选标题（`AI_GENERATE`、`AI_GENERATE`、`AI_GENERATE`）。
2. 用 `ANY` 策略合并（先到的赢）。
3. 用赢的标题继续。

执行：

1. 三个 `AI_GENERATE` 节点并行跑。
2. 第一个完成的满足 `CONTROL_MERGE` 的 `ANY`。其他两个通常被 `CANCELED` 释放资源（依准入取消策略）。
3. 下游用赢的标题继续。

策略语义在这里很重要。`ALL` 等三个；`ANY` 取最早；`N_OF_M` 让工作流挑「3 选 N 的最佳」并带后备。策略是声明的，不是运行时即兴。

## 来源

- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/tables/workflow-node-types.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/workflow-node-types.yaml)
- [`.nimi/spec/runtime/kernel/tables/workflow-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/workflow-states.yaml)
- [`.nimi/spec/runtime/kernel/tables/scenario-types.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/scenario-types.yaml)
- [`.nimi/spec/runtime/kernel/tables/scenario-execution-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/scenario-execution-matrix.yaml)
- [`.nimi/spec/runtime/kernel/tables/job-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/job-states.yaml)
- [`.nimi/spec/runtime/kernel/tables/state-transitions.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/state-transitions.yaml)
