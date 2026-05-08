# 工作流

工作流是 Runtime 的强类型执行图，用来跑超过单次请求-响应的 AI 工作。本页讲清楚工作流模型、强类型节点、状态机，以及合并策略。

流式细节见 [流式](/zh/runtime/streaming)；非文本产物见 [多模态](/zh/runtime/multimodal)。

## 工作流是什么

工作流是一张由强类型节点构成的 DAG。App 通过组合准入节点种类来构建工作流；执行、重试、分支、合并、审计都归 Runtime。

| 属性 | 值 |
| --- | --- |
| 形态 | 有向无环图 |
| 节点种类 | 三类共 15 种强类型 |
| 重试 | 节点级，按准入契约 |
| 分支 | 通过 `CONTROL_BRANCH` 条件分支 |
| 合并 | 通过 `CONTROL_MERGE` 加准入策略汇合 |
| 执行 | inline 或 external-async |

执行语义不归 App 自创。工作流由准入契约约束；未定义的节点种类 fail-closed。

## 15 种节点

| 类别 | 种类 |
| --- | --- |
| AI | `AI_GENERATE`、`AI_STREAM`、`AI_EMBED`、`AI_IMAGE`、`AI_VIDEO`、`AI_TTS`、`AI_STT`、`AI_TTS_CREATE_VOICE`、`AI_TTS_SYNTHESIZE` |
| Transform | `TRANSFORM_EXTRACT`、`TRANSFORM_TEMPLATE`、`TRANSFORM_SCRIPT` |
| Control | `CONTROL_BRANCH`、`CONTROL_MERGE`、`CONTROL_NOOP` |

每种节点都有强类型输入、强类型输出、准入的重试 / 分支 / 合并语义。节点种类在 Runtime 内核层级准入；新增节点需要内核扩展。

## 工作流状态机

| 状态 | 是否终态 |
| --- | --- |
| `ACCEPTED` | 否 |
| `QUEUED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `CANCELED` | 是 |
| `SKIPPED` | 是 |

工作流必然终止于 `COMPLETED | FAILED | CANCELED | SKIPPED` 之一。App 通过工作流事件流观察状态。

## 工作流事件流

工作流运行期间，Runtime 发出强类型事件：

| 事件 | 触发时机 |
| --- | --- |
| `STARTED` | 工作流进入 `RUNNING` |
| `NODE_STARTED` | 节点开始执行 |
| `NODE_PROGRESS` | 节点发出进度 |
| `NODE_COMPLETED` | 节点结束 |
| `NODE_SKIPPED` | 节点被跳过 |
| `COMPLETED` | 工作流到达 `COMPLETED` |
| `FAILED` | 工作流到达 `FAILED` |
| `CANCELED` | 工作流到达 `CANCELED` |

此外还有 external-async 变体，对应扇出到 provider 异步任务的节点（详见 [多模态](/zh/runtime/multimodal)）。

## 合并策略

多个并行分支汇聚到 `CONTROL_MERGE` 节点时，合并策略决定何时满足合并条件：

| 策略 | 满足条件 |
| --- | --- |
| `ALL` | 所有上游分支均完成 |
| `ANY` | 任一上游分支完成 |
| `N_OF_M` | N 个上游分支完成 |

合并策略在工作流构造时声明；Runtime 强制执行。

## inline 与 external-async 执行

| 模式 | 适用场景 |
| --- | --- |
| inline | 节点在工作流执行内部同步执行 |
| external-async | 节点扇出到 provider 异步任务或其他长任务外部工作；工作流跟踪外部生命周期 |

external-async 让一个包含长任务（比如视频生成）的工作流不必整体阻塞。Provider 异步生命周期（`queued → running → succeeded | failed | expired`）被归一化进工作流状态机。

## ScenarioJob 接桥

工作流的 AI 节点经 `ScenarioJob` 路由，以获得统一执行语义。`ScenarioJob` 是任意 AI 请求共享的生命周期：

| 状态 | 是否终态 |
| --- | --- |
| `SUBMITTED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是 |
| `FAILED` | 是 |
| `TIMEOUT` | 是 |
| `CANCELED` | 是 |

如果 App 想要一个统一句柄观察任意 AI 工作，就把 `ScenarioJob` 当成桥：每种模态、每个 provider、每个工作流节点最终都扇出到 `ScenarioJob` 生命周期。

## 场景：多步工作流

App 构造一个工作流，做这几件事：

1. 从 PDF 抽文本（`TRANSFORM_EXTRACT`）。
2. 嵌入抽出的文本（`AI_EMBED`）。
3. 生成结构化分析（`AI_GENERATE`）。
4. 把分析合成为 TTS（`AI_TTS`）。

执行过程：

1. 工作流进入 `ACCEPTED`。校验 DAG，准入节点种类，记录重试 / 分支 / 合并契约。
2. 工作流切到 `QUEUED`，再到 `RUNNING`。`STARTED` 事件触发。
3. 节点 1 运行：`NODE_STARTED → NODE_PROGRESS → NODE_COMPLETED`。
4. 节点 2 运行。嵌入结果是强类型的。
5. 节点 3 运行。结构化输出是强类型的；schema 校验不过则节点失败（此时工作流尚未失败）。
6. 节点 4 运行。TTS 产物按多模态产物契约交付。
7. 工作流到达 `COMPLETED`，写入审计。

任何节点遇到契约失败时，工作流的终态依赖节点级重试策略。瞬时错误可能重试；契约失败按 fail-closed 处理。

## 场景：分支与合并

App 构造一个工作流，做这几件事：

1. 并行生成三个候选 caption（三个 `AI_GENERATE`）。
2. 用 `ANY` 策略合并（最先完成胜出）。
3. 沿用胜出 caption 继续。

执行过程：

1. 三个 `AI_GENERATE` 并行运行。
2. 第一个完成的满足 `CONTROL_MERGE` 的 `ANY`。其余两个通常会被 `CANCELED` 释放资源（取决于准入的取消策略）。
3. 下游沿用胜出 caption 继续。

策略语义在这里很要紧。`ALL` 会等齐三个；`ANY` 取最先完成的；`N_OF_M` 让工作流挑出"3 选 N"配合回退。策略由声明给出，运行时不能临时改。

## Source Basis

- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/tables/workflow-node-types.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/workflow-node-types.yaml)
- [`.nimi/spec/runtime/kernel/tables/workflow-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/workflow-states.yaml)
- [`.nimi/spec/runtime/kernel/tables/scenario-types.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/scenario-types.yaml)
- [`.nimi/spec/runtime/kernel/tables/scenario-execution-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/scenario-execution-matrix.yaml)
- [`.nimi/spec/runtime/kernel/tables/job-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/job-states.yaml)
- [`.nimi/spec/runtime/kernel/tables/state-transitions.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/state-transitions.yaml)
