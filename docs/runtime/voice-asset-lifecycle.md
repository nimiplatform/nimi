# Voice Asset Lifecycle and Speech Synthesis

In Nimi's acoustic architecture, voice asset creation (`voice.create`) and speech synthesis (`audio.synthesize`) have distinct responsibilities. Developers can clone voices from reference audio or generate novel timbres from natural language descriptions into managed `VoiceAsset` resources, which can then be referenced across interactive voice workflows.

## Two Voice Creation Modes

Applications submit voice creation requests through the SDK:

| Source Mode | Required Inputs | Model Capability Prerequisite | Use Case |
| --- | --- | --- | --- |
| **Reference Audio** | `referenceAudio` bytes/URI, `referenceAudioMime`, `preferredName`, `languageHints`, `text` (use `""` if no transcript is provided) | Engine supports `input.audio` | Voice cloning, realistic persona reproduction |
| **Text Description** | `instructionText`, `previewText`, `language`, `preferredName` | Engine supports `input.text` | Crafting novel voices for fictional companions |

On the wire, these map to `REFERENCE_AUDIO` and `TEXT_DESCRIPTION` under `VoiceCreationSource`, producing standardized `VoiceAsset` entries managed by Runtime.

## Code Example: Creating a Voice from Text Description

```ts
import type { NimiLocalAppClient } from '@nimiplatform/sdk';

/**
 * Submit a voice creation job from text descriptions.
 * Recommended: save clientSubmissionId in app-local storage to track across network interruptions.
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

The method returns a unique `jobId`. The application tracks progress with `client.ai.scenarioJobs.get(jobId)` until it achieves `completed` status.

## Asset Results and Voice References

Upon successful completion, reading the job returns the managed asset record and a canonical reference handle:

| Result Field | Meaning | Description |
| --- | --- | --- |
| `asset.voiceAssetId` | Globally unique ID of the managed voice asset | Passed to synthesis calls to select this voice |
| `asset.creationSource` | Creation mode (`reference-audio` or `text-description`) | Source lineage auditing |
| `asset.status` | Operational health (`active`, `expired`, `deleted`) | Confirms availability before initiating synthesis |
| `voiceReference` | Standardized reference `{ kind: 'voice_asset_id', voiceAssetId }` | Read `voiceAssetId` and build the synthesis input shown below |

`voiceReference` is the job-result shape; synthesis accepts a different input shape named `voiceRef`. Take `voiceReference.voiceAssetId` and build `{ type: 'voice-asset', id: voiceAssetId }` rather than passing the result object unchanged.

## Managing and Synthesizing Voices

| Task | Recommended SDK API |
| --- | --- |
| **List Built-in Preset Voices** | `client.aiConfig.listOptions({ kind: 'preset-voices' })` |
| **List Custom Voices for this App** | `client.ai.voiceAssets.list({ pageSize: 20 })` |
| **Delete a Custom Voice** | `client.ai.voiceAssets.delete(voiceAssetId)` |

When executing speech synthesis, set `voiceRef` to `{ type: 'voice-asset', id: voiceAssetId }` or `{ type: 'preset', id: presetVoiceId }`, and Runtime validates voice compatibility with the configured `audio.synthesize` route. Read the audio artifact after the Job completes.

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`examples/sdk/07-voice-create.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/07-voice-create.ts)
