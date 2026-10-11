# 音色资源生命周期与语音合成（Voice Asset Lifecycle）

在 Nimi 的语音架构中，音色资源创建（`voice.create`）与语音合成调用（`audio.synthesize`）遵循明确分工的生命周期。开发者可以通过参考音频克隆或文字音色描述生成由 Runtime 托管的专属音色资源（`VoiceAsset`），并在后续的语音交互中直接引用该音色。

## 音色创建的两种来源模式

应用通过受保护的 SDK 客户端提交音色创建请求：

| 创建来源 | 必需参数 | 底层能力要求 | 适用场景 |
| --- | --- | --- | --- |
| **参考音频（Reference Audio）** | `referenceAudio` 字节流/URI、`referenceAudioMime`、`preferredName`、`languageHints`、`text`（无参考转写时传空字符串 `""`） | 推理模型支持 `input.audio` | 声音克隆、复刻真实人物声线 |
| **文字描述（Text Description）** | `instructionText`（音色提示词）、`previewText`（试听文本）、`language`、`preferredName` | 推理模型支持 `input.text` | 创意设计虚构角色的个性化声线 |

在底层协议中，两种来源分别对应 `VoiceCreationSource` 的 `REFERENCE_AUDIO` 与 `TEXT_DESCRIPTION`，统一输出由 Runtime 管理的标准 `VoiceAsset`。

## 代码示例：通过文字描述创建音色

```ts
import type { NimiLocalAppClient } from '@nimiplatform/sdk';

/**
 * 通过文字音色描述发起音色创建任务
 * 在调用前推荐在应用本地存储中生成并保存唯一的 clientSubmissionId，以便在网络重连时追踪该任务
 */
export async function submitVoiceDescription(
  client: NimiLocalAppClient,
  clientSubmissionId: string,
  instructionText: string,
  previewText: string,
) {
  return await client.ai.scenarioJobs.submit({
    type: 'voice-create',
    creationSource: 'text-description',
    instructionText,
    previewText,
    language: 'en',
    preferredName: 'My custom voice',
  }, { clientSubmissionId });
}
```

提交成功后，接口返回一个唯一的 `jobId`。应用可通过 `client.ai.scenarioJobs.get(jobId)` 跟踪任务进展，直至任务完成并返回生成的音色资源详情。

## 音色资源结果与引用结构

当任务成功达到终态（`completed`）时，读取接口会返回完整的音色资源及通用引用对象：

| 结果字段 | 业务含义 | 用途说明 |
| --- | --- | --- |
| `asset.voiceAssetId` | Runtime 托管的音色资源全局唯一 ID | 用于后续语音合成时的音色指定 |
| `asset.creationSource` | 音色创建模式（音频克隆或文字生成） | 元数据追溯 |
| `asset.status` | 资源当前状态（`active`, `expired`, `deleted`） | 校验该音色是否处于可用状态 |
| `voiceReference` | 标准化的音色引用结构体 `{ kind: 'voice_asset_id', voiceAssetId }` | 直接传入语音合成或 Agent 呈现设置中 |

## 音色的日常管理与语音合成使用

| 业务任务 | 推荐 SDK 接口 |
| --- | --- |
| **查询系统内置的预设音色** | `client.aiConfig.listOptions({ kind: 'preset-voices' })` |
| **查询当前应用可用的自建音色** | `client.ai.voiceAssets.list({ pageSize: 20 })` |
| **删除已创建的自建音色** | `client.ai.voiceAssets.delete(voiceAssetId)` |

在发起语音合成任务时，只需将 `voiceRef` 设为 `{ type: 'voice-asset', id: voiceAssetId }` 或 `{ type: 'preset', id: presetVoiceId }`，Runtime 即可自动路由并加载对应音色生成高保真音频流。

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`examples/sdk/07-voice-create.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/07-voice-create.ts)
