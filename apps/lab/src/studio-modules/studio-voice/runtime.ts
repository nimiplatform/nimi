import type { RuntimeVoiceCatalogRuntime } from '@nimiplatform/kit/features/generation/runtime';
import { buildNimiRuntimeScenarioJobIdentity } from '@nimiplatform/sdk/features/generation';
import { runNimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import {
  ExecutionMode,
  ScenarioType,
  VoiceAssetStatus,
  VoiceCreationSource,
} from '@nimiplatform/sdk/runtime/generated';
import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import {
  createStudioScenarioJobClient,
  projectStudioArtifactRunnerResult,
  projectStudioRunnerNonSuccess,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import {
  MAX_STUDIO_AUDIO_UPLOAD_BYTES,
  MAX_STUDIO_VOICE_REFERENCE_AUDIO_BYTES,
  type StudioSpeechSynthesizeParameters,
  type StudioSpeechTranscribeParameters,
  type StudioVoiceCreateParameters,
} from './parameters.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

// The Local App carrier derives the real subject from its protected session and
// intentionally does not project that identifier to product code. This token
// only correlates the Kit runner's request/response owner check and never
// crosses the Local App carrier.
const LOCAL_APP_OWNER_CORRELATION = 'protected-local-app-owner';

export const studioVoiceRuntimeHandlers: StudioCapabilityRuntimeHandlers = Object.freeze({
  'audio.synthesize': runSpeechSynthesize,
  'audio.transcribe': runSpeechTranscribe,
  'voice.create': runVoiceCreate,
  'speech.bundle': runSpeechBundle,
});

async function runSpeechSynthesize(context: StudioCapabilityRuntimeContext) {
  if (!context.prompt) return inputRequired(context);
  const parameters = context.input.parameters as StudioSpeechSynthesizeParameters | undefined;
  const voiceRef = speechVoiceReference(parameters);
  const result = await context.host.runners.speechSynthesize({
    runtime: { ai: createStudioScenarioJobClient(context) },
    appId: context.host.appId,
    text: context.prompt,
    ...(voiceRef ? { voiceRef } : {}),
    ...(parameters?.language !== undefined ? { language: parameters.language } : {}),
    ...(parameters?.audioFormat !== undefined ? { audioFormat: parameters.audioFormat } : {}),
    ...(parameters?.sampleRateHz !== undefined ? { sampleRateHz: parameters.sampleRateHz } : {}),
    ...(parameters?.speed !== undefined ? { speed: parameters.speed } : {}),
    ...(parameters?.pitch !== undefined ? { pitch: parameters.pitch } : {}),
    ...(parameters?.volume !== undefined ? { volume: parameters.volume } : {}),
    ...(parameters?.emotion !== undefined ? { emotion: parameters.emotion } : {}),
    ...(parameters?.timingMode !== undefined ? { timingMode: parameters.timingMode } : {}),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    ...(context.input.signal ? {
      signal: context.input.signal,
      abortReason: context.host.abortReason,
    } : {}),
  });
  return projectStudioArtifactRunnerResult(context, result);
}

async function runSpeechTranscribe(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioSpeechTranscribeParameters | undefined;
  if (!context.prompt && !parameters?.audioFile) return inputRequired(context);
  if (parameters?.audioFile && parameters.audioFile.sizeBytes > MAX_STUDIO_AUDIO_UPLOAD_BYTES) {
    return context.host.nonSuccess(
      context.capability,
      'input-invalid',
      'Speech transcription audio files must not exceed 32 MiB.',
    );
  }
  const inferredMimeType = context.prompt ? audioMimeTypeFromUrl(context.prompt) : null;
  const mimeType = parameters?.mimeType?.trim()
    || parameters?.audioFile?.mimeType
    || inferredMimeType;
  if (!mimeType || (!parameters?.audioFile && !isHttpsUrl(context.prompt))) {
    return context.host.nonSuccess(
      context.capability,
      'input-invalid',
      'Speech transcription requires an HTTPS audio URL with a MIME type or a local audio file up to 32 MiB.',
    );
  }
  const result = await context.host.runners.speechTranscribe({
    runtime: { ai: createStudioScenarioJobClient(context) },
    appId: context.host.appId,
    ...(parameters?.audioFile ? {
      audio: { type: 'bytes' as const, bytes: parameters.audioFile.bytes, mimeType },
    } : { audioUrl: context.prompt, mimeType }),
    ...(parameters?.language !== undefined ? { language: parameters.language } : {}),
    ...(parameters?.timestamps !== undefined ? { timestamps: parameters.timestamps } : {}),
    ...(parameters?.diarization !== undefined ? { diarization: parameters.diarization } : {}),
    ...(parameters?.speakerCount !== undefined ? { speakerCount: parameters.speakerCount } : {}),
    ...(parameters?.prompt !== undefined ? { prompt: parameters.prompt } : {}),
    ...(parameters?.responseFormat !== undefined ? { responseFormat: parameters.responseFormat } : {}),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    ...(context.input.signal ? {
      signal: context.input.signal,
      abortReason: context.host.abortReason,
    } : {}),
  });
  if (result.ok === false) return projectStudioRunnerNonSuccess(context, result);
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: result.message,
    output: {
      kind: 'transcript' as const,
      text: result.output.text,
      jobId: result.output.jobId,
      jobState: result.output.jobStatus,
      artifactCount: result.output.artifactCount,
    },
    ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
  };
}

async function runVoiceCreate(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioVoiceCreateParameters | undefined;
  const creationSource = parameters?.creationSource ?? 'reference-audio';
  if (!context.prompt && !parameters?.referenceAudioFile) return inputRequired(context);
  if (creationSource === 'reference-audio') {
    const audio = parameters?.referenceAudioFile;
    if (!audio || audio.sizeBytes === 0
      || audio.sizeBytes > MAX_STUDIO_VOICE_REFERENCE_AUDIO_BYTES
      || !audio.mimeType.startsWith('audio/')) {
      return context.host.nonSuccess(
        context.capability,
        'input-invalid',
        'Reference-audio voice creation requires a non-empty audio file up to 20 MiB with an audio MIME type.',
      );
    }
  }
  const identity = buildNimiRuntimeScenarioJobIdentity({
    appId: context.host.appId,
    capabilityId: 'voice.create',
    scenarioId: context.scenarioId,
  });
  const terminalResult = await runNimiRuntimeScenarioJob({
    ai: createStudioScenarioJobClient(context),
    request: {
      head: undefined,
      scenarioType: ScenarioType.VOICE_CREATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: {
        spec: creationSource === 'reference-audio'
          ? {
              oneofKind: 'voiceCreate',
              voiceCreate: {
                targetModelId: '',
                source: {
                  oneofKind: 'referenceAudio',
                  referenceAudio: {
                    referenceAudioBytes: parameters!.referenceAudioFile!.bytes,
                    referenceAudioUri: '',
                    referenceAudioMime: parameters!.referenceAudioFile!.mimeType,
                    languageHints: commaSeparatedTokens(parameters?.languageHints),
                    preferredName: parameters?.preferredName?.trim() ?? '',
                    text: context.prompt,
                  },
                },
              },
            }
          : {
              oneofKind: 'voiceCreate',
              voiceCreate: {
                targetModelId: '',
                source: {
                  oneofKind: 'textDescription',
                  textDescription: {
                    instructionText: context.prompt,
                    previewText: parameters?.previewText?.trim() ?? '',
                    language: parameters?.language?.trim() ?? '',
                    preferredName: parameters?.preferredName?.trim() ?? '',
                  },
                },
              },
            },
      },
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: { scenarioId: context.scenarioId, surfaceId: context.host.surfaceId },
      extensions: [],
    },
    ...(context.input.signal ? {
      signal: context.input.signal,
      abortReason: context.host.abortReason,
    } : {}),
  });
  const terminalJob = terminalResult.job;
  const resultAsset = terminalResult.asset;
  const voiceReference = terminalResult.voiceReference;
  const expectedCreationSource = creationSource === 'reference-audio'
    ? VoiceCreationSource.REFERENCE_AUDIO
    : VoiceCreationSource.TEXT_DESCRIPTION;
  if (!resultAsset || resultAsset.status !== VoiceAssetStatus.ACTIVE
    || resultAsset.creationSource !== expectedCreationSource) {
    throw new Error('Completed voice.create did not return an ACTIVE VoiceAsset with the requested source.');
  }
  const returnedVoiceReference = voiceReference?.reference;
  const returnedVoiceAssetId = returnedVoiceReference?.oneofKind === 'voiceAssetId'
    ? (returnedVoiceReference as { readonly oneofKind: 'voiceAssetId'; readonly voiceAssetId: string }).voiceAssetId
    : '';
  if (!returnedVoiceAssetId || returnedVoiceAssetId !== resultAsset.voiceAssetId) {
    throw new Error('Completed voice.create did not return an exact VoiceAsset reference.');
  }
  const listed = await context.host.client.ai.voiceAssets.list({ pageSize: 100 });
  const listedAsset = listed.assets.find((asset) => asset.voiceAssetId === resultAsset.voiceAssetId);
  if (!listedAsset || listedAsset.status !== 'active' || listedAsset.creationSource !== creationSource) {
    throw new Error('Completed voice.create did not project its ACTIVE VoiceAsset through the protected owner catalog.');
  }
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: `Runtime completed voice.create (${creationSource}) and returned a reusable VoiceAsset.`,
    output: {
      kind: 'voice-asset' as const,
      jobId: terminalJob.jobId,
      jobState: 'completed',
      voiceAssetId: listedAsset.voiceAssetId,
      creationSource: listedAsset.creationSource,
      assetStatus: listedAsset.status,
      voiceReference: { kind: 'voice_asset_id' as const, voiceAssetId: resultAsset.voiceAssetId },
    },
    ...(terminalJob.traceId ? { trace: { traceId: terminalJob.traceId } } : {}),
  };
}

async function runSpeechBundle(context: StudioCapabilityRuntimeContext) {
  const result = await context.host.runners.voiceCatalog({
    runtime: createLocalAppVoiceCatalogRuntime(context),
    appId: context.host.appId,
    subjectUserId: LOCAL_APP_OWNER_CORRELATION,
  });
  if (result.ok === false) return projectStudioRunnerNonSuccess(context, result);
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: result.message,
    output: {
      kind: 'voice-catalog' as const,
      voiceCount: result.output.voiceCount,
      sample: result.output.voiceReferences.slice(0, 20).map((voice) => ({
        voiceId: voice.voiceAssetId,
        creationSource: VoiceCreationSource[voice.creationSource] || String(voice.creationSource),
        status: VoiceAssetStatus[voice.status] || String(voice.status),
      })),
    },
  };
}

function inputRequired(context: StudioCapabilityRuntimeContext) {
  return context.host.nonSuccess(
    context.capability,
    'input-invalid',
    `${context.capability.label} requires non-empty input.`,
  );
}

function createLocalAppVoiceCatalogRuntime(
  context: StudioCapabilityRuntimeContext,
): RuntimeVoiceCatalogRuntime {
  return {
    ai: {
      async listVoiceAssets(request) {
        const result = await context.host.client.ai.voiceAssets.list({
          pageSize: request.pageSize,
          pageToken: request.pageToken,
        });
        return {
          assets: result.assets.map((asset) => ({
            voiceAssetId: asset.voiceAssetId,
            appId: request.appId,
            subjectUserId: request.subjectUserId,
            creationSource: asset.creationSource === 'text-description'
              ? VoiceCreationSource.TEXT_DESCRIPTION
              : VoiceCreationSource.REFERENCE_AUDIO,
            provider: '',
            modelId: '',
            targetModelId: '',
            providerVoiceRef: '',
            persistence: 0,
            status: localVoiceAssetStatus(asset.status),
            ...(asset.createdAt ? { createdAt: asset.createdAt } : {}),
            ...(asset.updatedAt ? { updatedAt: asset.updatedAt } : {}),
            ...(asset.expiresAt ? { expiresAt: asset.expiresAt } : {}),
          })),
          nextPageToken: result.nextPageToken,
        };
      },
    },
  };
}

function localVoiceAssetStatus(status: 'active' | 'expired' | 'deleted' | 'failed'): VoiceAssetStatus {
  if (status === 'active') return VoiceAssetStatus.ACTIVE;
  if (status === 'expired') return VoiceAssetStatus.EXPIRED;
  if (status === 'deleted') return VoiceAssetStatus.DELETED;
  return VoiceAssetStatus.FAILED;
}

function speechVoiceReference(parameters: StudioSpeechSynthesizeParameters | undefined) {
  if (parameters?.voiceKind === 'preset' && parameters.voicePreset?.trim()) {
    return { kind: 'preset_voice_id' as const, presetVoiceId: parameters.voicePreset.trim() };
  }
  if (parameters?.voiceKind === 'asset' && parameters.voiceAssetId?.trim()) {
    return { kind: 'voice_asset_id' as const, voiceAssetId: parameters.voiceAssetId.trim() };
  }
  return undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function audioMimeTypeFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const extension = url.pathname.split('.').pop()?.toLowerCase();
    if (extension === 'wav') return 'audio/wav';
    if (extension === 'mp3') return 'audio/mpeg';
    if (extension === 'm4a') return 'audio/mp4';
    if (extension === 'ogg') return 'audio/ogg';
    if (extension === 'webm') return 'audio/webm';
    if (extension === 'flac') return 'audio/flac';
    return null;
  } catch {
    return null;
  }
}

function commaSeparatedTokens(value: string | undefined): string[] {
  return (value ?? '').split(',').map((token) => token.trim()).filter(Boolean);
}
