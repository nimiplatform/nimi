# 多模态

多模态工作产出非文本 artifact。Runtime 拥有规范化的输入字段、artifact 形状、适配器路由、投递闸口。App 显示或消费 artifact；它们不重新定义 artifact 真相。

## 能力面

Runtime 多模态合同覆盖：

| 能力 | 产出什么 |
| --- | --- |
| 图像 | 图像引擎产出的栅格图 |
| 视频 | 视频引擎产出的视频 artifact |
| 音频 | 音频生成 |
| 语音 | 文本转语音（`AI_TTS`），含声音克隆（`AI_TTS_CREATE_VOICE`、`AI_TTS_SYNTHESIZE`） |
| 音乐 | 音乐生成，含迭代支持 |

每种能力有准入的规范化输入字段、准入的 artifact 形状、准入的投递闸口。App 不能新发明 MIME 类型，也不能跳过投递闸口。

## 规范化输入字段

每次多模态请求都有规范化的类型化输入。App 按合同构造输入：

| 字段 | 用途 |
| --- | --- |
| 能力 id | 调的是哪种能力 |
| Provider 上下文 | 可选的 Provider 特定扩展 |
| 资源引用 | 输入资源（已有 artifact） |
| 生成参数 | 能力特定参数 |

规范化字段在 `runtime/kernel/tables/multimodal-canonical-fields.yaml`。产出脱合同输入形状的 App 在准入时 fail-close。

## Provider 异步任务生命周期

多模态生成通常是长跑的。Runtime 把它们建模为 **Provider 异步任务**，生命周期类型化：

| 状态 | 终态？ |
| --- | --- |
| `queued` | 否 |
| `running` | 否 |
| `succeeded` | 是 |
| `failed` | 是 |
| `expired` | 是（等价于超时） |

注意小写 snake（vs `ScenarioJob` 用大写 SNAKE）。Provider 异步任务是 Provider 边界上的规范化；大小写贴合 Provider 语义。

### 异步到 ScenarioJob 的映射

Provider 异步终态确定地映到 `ScenarioJob` 终态：

| Provider 异步状态 | ScenarioJob 终态 |
| --- | --- |
| `succeeded` | `COMPLETED` |
| `expired` | `TIMEOUT` |
| `failed` | `FAILED` |

映射规则（`K-MMPROV-027`）已准入；App 在跨模态时看到的是统一形状。

## Artifact 规范化

多模态输出落为带规范化字段的 **artifact**。App 通过 artifact 合同消费：

| 字段 | 用途 |
| --- | --- |
| Artifact id | 稳定身份 |
| MIME 类型 | 来自合同，不是猜的 |
| 字节 / 引用 | 在哪儿读 artifact |
| 来源 | 谁产出的、在哪条请求 lineage 下 |
| 投递闸口裁定 | 闸口是否准入投递 |

Artifact 字段准入在 `runtime/kernel/tables/multimodal-artifact-fields.yaml`。少必填字段的 artifact fail-close。

## 投递闸口

多模态 artifact 不会因生成成功就自动到 App。**投递闸口** 决定一份 artifact 什么时候可以投递。

| 闸口关注 | 为什么重要 |
| --- | --- |
| 敏感度分类 | 某些 artifact 需要审批 |
| 来源 | 来源不全的 artifact 可能被隔离 |
| Schema 校验 | 脱合同 artifact fail-close |
| 用户策略 | 用户偏好可能闸住投递 |

Runtime 投递闸口表（`runtime/kernel/tables/runtime-delivery-gates.yaml`）准入具体闸口。App 看到闸口裁定；它们不绕过。

## 音乐迭代支持

音乐生成准入迭代模型：一份 artifact 可以在类型化参数下迭代产出变体。

| 性质 | 值 |
| --- | --- |
| 迭代种类 | `MUSIC_GENERATE`（`K-MMPROV-*` 准入） |
| Lineage | 每次迭代引用上一份 artifact |
| 审计 | 迭代作为工作流 lineage 的一部分被记下 |

迭代受准入合同约束；App 不能在运行时新发明迭代种类。

## 声音克隆支持

语音能力按类型化合同准入声音克隆。

| 操作 | 用途 |
| --- | --- |
| `AI_TTS_CREATE_VOICE` | 从输入音频建一份声音 profile |
| `AI_TTS_SYNTHESIZE` | 用准入声音 profile 合成语音 |
| `AI_TTS` | 用准入声音的标准 TTS |

`VoiceAsset` 生命周期准入在语音合同（`K-VOICE-*`）；声音 profile 有准入的引用合同。

## 阅读场景：图像生成工作流

App 用一个长跑 Provider 生成图像。

1. **工作流节点。** 工作流里有个 `AI_IMAGE` 节点。
2. **ScenarioJob 创建。** 节点扇出到 `ScenarioJob`。
3. **Provider 异步任务。** Provider 返回 task id；状态走 `queued → running`。
4. **Polling / 流式。** Runtime 跟踪任务。工作流事件流推外部异步进度事件。
5. **任务成功。** Provider 状态搬到 `succeeded`。按 `K-MMPROV-027`，`ScenarioJob` 终态变成 `COMPLETED`。
6. **Artifact 投递。** 图像 artifact 有规范化字段、MIME 类型、来源。投递闸口校验 schema、来源、敏感度。准入则投递完成。
7. **App 拿到 artifact。** 通过 SDK 类型化 artifact 形状。MIME 类型来自合同；App 不猜。

**没**发生：App 没拿到一个无来源的自由 URL；App 没看到猜的 MIME 类型；artifact 没绕开投递闸口。

## 阅读场景：音乐迭代

用户生成音乐并想迭代。

1. **第一次生成。** 跑一个音乐工作流；产出一份 artifact。
2. **迭代请求。** App 用类型化参数发起迭代，引用原 artifact。
3. **`MUSIC_GENERATE` 被准入。** 在 `K-MMPROV-*` 下准入。
4. **Provider 异步生命周期。** 迭代过 Provider 异步生命周期。状态映到 `ScenarioJob` 终态如前。
5. **新 artifact。** 迭代 artifact 引用原 artifact；lineage 被保留。

迭代是类型化操作；lineage 是结构上的，不是 docstring。

## 阅读场景：Provider 异步任务到期

一次长视频生成撞到 Provider 侧的超时。

1. **Provider 状态** 从 `running` 搬到 `expired`。
2. **映射。** 按 `K-MMPROV-027`，`ScenarioJob` 终态变成 `TIMEOUT`。
3. **工作流影响。** 节点的工作流状态搬到 `FAILED`（或按准入重试策略走重试路径）。
4. **审计。** 到期带原因被记下。

App 看到的是类型化的 `TIMEOUT`，不是「请求以某种方式失败了」；`ScenarioJob` 终态类型告诉 App 发生了什么。

## 来源

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
