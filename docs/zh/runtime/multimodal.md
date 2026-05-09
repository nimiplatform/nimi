# 多模态

多模态产出的不是文本。Runtime 持有规范输入字段、产物形状、适配器路由、交付门控；App 负责展示或消费产物，不能重新定义产物的真值。

## 能力面

Runtime 的多模态契约覆盖以下能力：

| 能力 | 产出物 |
| --- | --- |
| 图像 | 由图像引擎生成的栅格图像 |
| 视频 | 由视频引擎生成的视频产物 |
| 音频 | 音频生成 |
| 语音 | 文本转语音（`AI_TTS`），含声音克隆（`AI_TTS_CREATE_VOICE`、`AI_TTS_SYNTHESIZE`） |
| 音乐 | 音乐生成，包含迭代支持 |

每种能力都对应准入的规范输入字段、准入的产物形状、准入的交付门控。App 不能自创新的产物 MIME 类型，也不能跳过交付门控。

## 规范输入字段

每次多模态请求都有一份强类型的规范输入。App 按契约组装：

| 字段 | 用途 |
| --- | --- |
| Capability id | 调用的是哪个能力 |
| Provider context | 可选的 provider 专属扩展 |
| Resource references | 输入资源（已存在的产物） |
| Generation parameters | 该能力的专用参数 |

规范字段定义在 `runtime/kernel/tables/multimodal-canonical-fields.yaml`。如果 App 给出的输入形状不符合契约，准入阶段就会 fail-closed。

## Provider 异步任务生命周期

多模态生成通常是长任务。Runtime 把它建模成 **provider 异步任务**，配套强类型生命周期：

| 状态 | 是否终态 |
| --- | --- |
| `queued` | 否 |
| `running` | 否 |
| `succeeded` | 是 |
| `failed` | 是 |
| `expired` | 是（等价于超时） |

注意这里用 lower_snake，与 `ScenarioJob` 的 UPPER_SNAKE 区分。Provider 异步任务是 provider 边界上的归一化；命名沿用 provider 语义。

### 异步态到 ScenarioJob 的映射

Provider 异步终态确定性地映射到 `ScenarioJob` 终态：

| Provider 异步态 | ScenarioJob 终态 |
| --- | --- |
| `succeeded` | `COMPLETED` |
| `expired` | `TIMEOUT` |
| `failed` | `FAILED` |

映射规则（`K-MMPROV-027`）已准入；App 跨模态看到的是同一种统一形状。

## 产物归一化

多模态输出归为一份**产物**，带强类型规范字段。App 通过产物契约消费：

| 产物字段 | 用途 |
| --- | --- |
| Artifact id | 稳定身份 |
| MIME type | 由契约给出，不靠猜测 |
| Bytes / 引用 | 在哪里读取产物 |
| Provenance | 谁产出的，源自哪条请求链路 |
| 交付门控裁决 | 门控是否准入交付 |

产物字段准入定义在 `runtime/kernel/tables/multimodal-artifact-fields.yaml`。缺必填字段的产物会 fail-closed。

## 交付门控

多模态产物生成成功，并不意味着它会立刻送到 App 手里。**交付门控**决定一份产物何时允许交付。

| 门控关注点 | 为什么重要 |
| --- | --- |
| 敏感度分类 | 部分产物可能需要审批 |
| 来源完整性 | 来源不完整的产物可能被隔离 |
| Schema 校验 | 不符合契约的产物 fail-closed |
| 用户策略 | 用户偏好可以拦截交付 |

具体门控由 `runtime/kernel/tables/runtime-delivery-gates.yaml` 准入。App 看到门控裁决，但不能绕过它。

## 音乐迭代

音乐生成允许迭代：在准入的参数下，对一份产物迭代出变体。

| 属性 | 值 |
| --- | --- |
| 迭代种类 | `MUSIC_GENERATE`（按 `K-MMPROV-*` 准入） |
| 链路 | 每次迭代都引用前一份产物 |
| 审计 | 迭代记入工作流链路 |

迭代被准入契约约束；App 不能在运行时自造新的迭代种类。

## 声音克隆

语音能力在强类型契约下支持声音克隆。

| 操作 | 用途 |
| --- | --- |
| `AI_TTS_CREATE_VOICE` | 用输入音频创建声音档案 |
| `AI_TTS_SYNTHESIZE` | 用准入的声音档案合成语音 |
| `AI_TTS` | 使用准入声音的标准 TTS |

`VoiceAsset` 生命周期由声音契约（`K-VOICE-*`）准入；声音档案有准入的引用契约。

## 场景：图像生成工作流

App 通过一个长任务 provider 生成图像。

1. **工作流节点。** `AI_IMAGE` 节点是工作流的一部分。
2. **创建 ScenarioJob。** 节点扇出到一个 `ScenarioJob`。
3. **Provider 异步任务。** Provider 返回任务 id；状态 `queued → running`。
4. **轮询 / 流式。** Runtime 跟踪任务。工作流事件流发出外部异步进度事件。
5. **任务成功。** Provider 状态切到 `succeeded`。按 `K-MMPROV-027`，`ScenarioJob` 终态为 `COMPLETED`。
6. **产物交付。** 图像产物带强类型规范字段、MIME 类型、来源。交付门控校验 schema、来源、敏感度。准入则交付完成。
7. **App 收到产物。** 通过 SDK 的强类型产物形状。MIME 类型由契约给出，App 不需要猜。

没有发生过的事情：App 没有拿到一个无来源的自由 URL；App 没有看到被猜出来的 MIME；产物没有绕过交付门控。

## 场景：音乐迭代

用户生成了一段音乐，想做迭代。

1. **第一次生成。** 音乐工作流跑完，产出一份产物。
2. **请求迭代。** App 用强类型参数发起迭代，引用原始产物。
3. **`MUSIC_GENERATE` 准入。** 迭代按 `K-MMPROV-*` 准入。
4. **Provider 异步生命周期。** 迭代通过 provider 异步生命周期。状态按前述映射进入 `ScenarioJob` 终态。
5. **新产物。** 迭代产物引用原始产物；链路得以保留。

迭代是强类型操作；链路是结构化的，不靠注释。

## 场景：Provider 异步任务过期

一段长视频生成命中 provider 端的超时。

1. **Provider 状态切换：** 从 `running` 进入 `expired`。
2. **映射。** 按 `K-MMPROV-027`，`ScenarioJob` 终态为 `TIMEOUT`。
3. **工作流影响。** 节点的工作流状态切到 `FAILED`，或按准入的重试策略通过重试路径。
4. **审计。** 记录过期及原因。

App 看到的是强类型 `TIMEOUT`，不是模糊的"请求失败了"；`ScenarioJob` 的终态类型告诉 App 发生了什么。

## Source Basis

- [`.nimi/spec/runtime/multimodal-provider.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/multimodal-provider.md)
- [`.nimi/spec/runtime/multimodal-delivery-gates.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/multimodal-delivery-gates.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/voice-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/voice-contract.md)
- [`.nimi/spec/runtime/kernel/delivery-gates-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delivery-gates-contract.md)
- [`.nimi/spec/runtime/kernel/tables/multimodal-canonical-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/multimodal-canonical-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/multimodal-artifact-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/multimodal-artifact-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-delivery-gates.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-delivery-gates.yaml)
- [`.nimi/spec/runtime/kernel/tables/voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/voice-enums.yaml)
- [`.nimi/spec/runtime/kernel/tables/tts-provider-capability-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/tts-provider-capability-matrix.yaml)
