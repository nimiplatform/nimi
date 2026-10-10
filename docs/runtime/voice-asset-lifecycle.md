# Voice Asset Lifecycle

`voice.create` creates a Runtime-owned VoiceAsset from one typed source: reference audio or a text description. `audio.synthesize` uses an admitted voice reference to produce speech. Creating an asset, selecting an Agent's voice, and synthesizing audio are separate operations.

## One Capability, Two Source Forms

A Nimi App uses its host-bound `client.ai.scenarioJobs` surface:

| App spec | Source-specific inputs | Required implementation feature |
| --- | --- | --- |
| `type: 'voice-create'`, `creationSource: 'reference-audio'` | `referenceAudio`, `referenceAudioMime`, `languageHints`, `preferredName`, `text` | `input.audio` |
| `type: 'voice-create'`, `creationSource: 'text-description'` | `instructionText`, `previewText`, `language`, `preferredName` | `input.text` |

Reference audio uses the admitted bytes or URI union. Exact MIME, duration, language, and parameter limits depend on the configured implementation; an unsupported input fails without changing the route or target. `text` is an optional-content reference transcript field, not a voice-design instruction: use an empty string when no transcript is supplied.

Both forms map to Runtime ScenarioType `VOICE_CREATE`. On the wire, `VoiceCreationSource` distinguishes `REFERENCE_AUDIO` and `TEXT_DESCRIPTION`, and the resulting asset records `creation_source`. This source is provenance, not a second capability or routing choice.

## Submit a Description

Prepare the `voice.create` AIConfig and its selected Local Loadout or exact Cloud configuration first. The implementation must support `input.text` for this example. Save a unique `clientSubmissionId` in App storage before submitting so a lost response can be recovered without generating again.

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

The returned Job means submission succeeded; it does not yet mean a voice asset exists. Observe the original `jobId` with `client.ai.scenarioJobs.get(jobId)`. If the submit response was lost, use `lookupSubmission(clientSubmissionId)` to recover its identity, then Get that original Job. A failed lookup or uncertain outcome is not permission to resubmit.

## Read the Complete Result

A successful terminal Get returns both `asset` and `voiceReference`. Subscription events are progress hints and do not carry the complete voice result. Do not infer an asset from a completed event or decode an artifact as a substitute for these fields.

| App result field | Meaning |
| --- | --- |
| `asset.voiceAssetId` | Runtime-owned asset identity |
| `asset.creationSource` | `reference-audio` or `text-description` |
| `asset.status` | `active`, `expired`, `deleted`, or `failed` |
| `asset.createdAt`, `asset.updatedAt`, `asset.expiresAt` | Runtime-issued timestamps, or null when absent |
| `voiceReference` | `{ kind: 'voice_asset_id', voiceAssetId }` for the created asset |

The App result is a bounded projection, not the full Runtime wire object. Provider handles, account selectors, credentials, and implementation custody do not enter the App asset. A VoiceAsset reference does not promise indefinite availability: respect the reported expiry, current authorization, and the implementation's persistence/deletion policy.

## Discover, Use, and Delete

| Task | Host-bound App API |
| --- | --- |
| List preset voices for the current configuration | `client.aiConfig.listOptions({ kind: 'preset-voices' })` |
| List the App's authorized created voice assets | `client.ai.voiceAssets.list({ pageSize: 20 })` |
| Delete an authorized created asset | `client.ai.voiceAssets.delete(voiceAssetId)` |

Preset and created-asset discovery remain separate. A `speech-synthesize` Job uses `voiceRef: { type: 'preset', id }` or `{ type: 'voice-asset', id }`, along with its required synthesis inputs. The created-asset `id` is the returned `voiceAssetId`; never supply a provider-native handle. Voice compatibility is validated against the synthesis configuration.

Selecting an Agent's voice is a separately authorized presentation configuration action; creation alone does not change that setting. A missing, expired, deleted, incompatible, or unauthorized voice produces the actual typed failure without substituting a default voice.

Deletion uses the asset's own captured target and policy, independently of the current AIConfig. Preserve a provider deletion failure for explicit retry; do not report success from a local UI removal. Voice creation, transcription, synthesis, and voice conversion each keep their own capability contract.

See [Job Observation](/runtime/streaming) for Get cadence, observation detachment, cancellation, and complete result handling.

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/voice.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/voice.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai.ts)
- [`examples/sdk/07-voice-create.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/07-voice-create.ts)
