# 音色资源生命周期

`voice.create` 根据一种强类型来源创建 Runtime 管理的 VoiceAsset：参考音频或文字描述。`audio.synthesize` 使用已准入音色引用生成语音。创建资源、选择 Agent 音色和合成音频是不同操作。

## 一个能力，两种来源

Nimi App 使用绑定宿主的 `client.ai.scenarioJobs`：

| App spec | 来源专属输入 | 实现必须支持的功能 |
| --- | --- | --- |
| `type: 'voice-create'`、`creationSource: 'reference-audio'` | `referenceAudio`、`referenceAudioMime`、`languageHints`、`preferredName`、`text` | `input.audio` |
| `type: 'voice-create'`、`creationSource: 'text-description'` | `instructionText`、`previewText`、`language`、`preferredName` | `input.text` |

参考音频使用已准入的 bytes 或 URI 联合类型。确切 MIME、时长、语言和参数限制取决于已配置实现；输入不受支持时直接失败，不切换路径或目标。`text` 字段用于可选参考转写，不是音色设计指令；没有转写时传空字符串。

两种来源都映射为 Runtime ScenarioType `VOICE_CREATE`。Wire 中以 `VoiceCreationSource` 区分 `REFERENCE_AUDIO` 与 `TEXT_DESCRIPTION`，结果资源通过 `creation_source` 记录来源。这是来源信息，不是第二种能力或路由选择。

## 提交文字描述

先准备 `voice.create` AIConfig，以及机器选中的 Local Loadout 或确切 Cloud 配置。本例要求实现支持 `input.text`。提交前在 App 存储保存唯一 `clientSubmissionId`，以便响应丢失后恢复原工作，不重复生成。

```ts
import type { NimiLocalAppClient } from '@nimiplatform/sdk';

/** Save clientSubmissionId in App storage before calling; recover the original Job by it. */
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
    preferredName: 'My voice',
  }, { clientSubmissionId });
}
```

返回 Job 只表示提交成功，不代表音色资源已经创建。通过 `client.ai.scenarioJobs.get(jobId)` 观察原 Job。提交响应丢失时，用 `lookupSubmission(clientSubmissionId)` 恢复原身份，再 Get 原 Job；查询失败或结果不确定都不授权重新提交。

## 读取完整结果

成功终态 Get 同时返回 `asset` 和 `voiceReference`。订阅事件只用于进度提示，不携带完整音色结果。不能从 completed 事件推断资源，也不能用解码 artifact 来替代这两个结果字段。

| App 结果字段 | 含义 |
| --- | --- |
| `asset.voiceAssetId` | Runtime 管理的资源身份 |
| `asset.creationSource` | `reference-audio` 或 `text-description` |
| `asset.status` | `active`、`expired`、`deleted` 或 `failed` |
| `asset.createdAt`、`asset.updatedAt`、`asset.expiresAt` | Runtime 时间戳；缺失时为 null |
| `voiceReference` | 新资源的 `{ kind: 'voice_asset_id', voiceAssetId }` |

App 取得的是有限结果，不是完整 Runtime wire 对象。Provider 句柄、账号选择器、凭据和实现托管信息不进入 App 资源。持有 VoiceAsset 引用不代表永久可用，要遵循实际过期时间、当前授权及实现的持久化/删除策略。

## 发现、使用和删除

| 任务 | 绑定宿主的 App API |
| --- | --- |
| 列出当前配置的预设音色 | `client.aiConfig.listOptions({ kind: 'preset-voices' })` |
| 列出该 App 获准访问的自建音色 | `client.ai.voiceAssets.list({ pageSize: 20 })` |
| 删除获准访问的自建音色 | `client.ai.voiceAssets.delete(voiceAssetId)` |

预设音色和自建资源分别发现。`speech-synthesize` Job 使用 `voiceRef: { type: 'preset', id }` 或 `{ type: 'voice-asset', id }`，并携带必要合成输入。自建资源的 `id` 是返回的 `voiceAssetId`，不能填写 Provider 原生句柄；Runtime 按合成配置检查音色兼容性。

选择 Agent 音色是独立授权的呈现配置操作，创建资源本身不会修改该设置。音色缺失、过期、删除、不兼容或未授权时返回真实强类型失败，不替换成默认音色。

删除依据资源自身固定的目标和策略，不依赖当前 AIConfig。Provider 删除失败时保留原因供明确重试，不能仅因界面移除条目就报告成功。音色创建、转写、语音合成和声音转换各自保留独立能力契约。

Get 频率、结束观察、取消与完整结果处理见 [Job 观察](/zh/runtime/streaming)。

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/voice.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/voice.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai.ts)
- [`examples/sdk/07-voice-create.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/07-voice-create.ts)
