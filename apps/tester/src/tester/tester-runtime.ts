import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import {
  runRuntimeAIConsumeCapability,
  runRuntimeImageGenerate,
  runRuntimeSpeechSynthesize,
  runRuntimeSpeechTranscribe,
  runRuntimeVideoGenerate,
  runRuntimeVoiceCatalog,
  type RuntimeAIConsumeRuntime,
  type RuntimeVoiceCatalogRuntime,
} from '@nimiplatform/kit/features/generation/runtime';
import type { NimiRuntimeAIScenarioClient } from '@nimiplatform/sdk/ai';
import {
  createNimiLocalAppRuntimeScenarioJobClient,
  type NimiLocalAppClient,
  type NimiLocalAppTextTurnEvent,
} from '@nimiplatform/sdk/app';
import {
  ExecutionMode,
  FinishReason,
  ScenarioType,
  VoiceAssetStatus,
  VoiceCreationSource,
} from '@nimiplatform/sdk/runtime/generated';
import { appId } from '../shell/auth/app-identity.js';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterLocalAppClient } from '../shell/local-app-runtime-platform.js';
import { getTesterCapability, type TesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import {
  MAX_TESTER_AUDIO_UPLOAD_BYTES,
  MAX_TESTER_VOICE_REFERENCE_AUDIO_BYTES,
  nonEmptyEmbeddingInputs,
  type TesterCapabilityParameters,
  type TesterEmbeddingParameters,
  type TesterImageGenerationParameters,
  type TesterSpeechSynthesizeParameters,
  type TesterSpeechTranscribeParameters,
  type TesterTextGenerationParameters,
  type TesterVideoGenerationParameters,
  type TesterVoiceCreateParameters,
} from './tester-capability-parameters.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';

export type TesterTrace = {
  traceId?: string;
  simulated?: boolean;
};

export type TesterTypedOutput =
  | { kind: 'text'; text: string; finishReason: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; streamed: boolean }
  | { kind: 'embedding'; vectorCount: number; dimensions: number; sample: number[]; totalTokens?: number }
  | { kind: 'artifacts'; jobId: string; jobState: string; artifactCount: number; artifacts: TesterManagedArtifact[]; firstArtifact?: TesterManagedArtifact }
  | { kind: 'transcript'; text: string; jobId: string; jobState: string; artifactCount: number }
  | { kind: 'voice-asset'; jobId: string; jobState: string; voiceAssetId: string; creationSource: 'reference-audio' | 'text-description'; assetStatus: string; voiceReference: { kind: 'voice_asset_id'; voiceAssetId: string } }
  | { kind: 'voice-catalog'; voiceCount: number; sample: Array<{ voiceId: string; creationSource: string; status: string }> };

export type TesterManagedArtifact = {
  relativePath: string;
  mediaType?: string;
  sizeBytes: number;
  sha256: string;
  displayName?: string;
  previewSource: 'managed-asset';
};

export type TesterTypedSuccess = {
  ok: true;
  capabilityId: TesterCapabilityId;
  capabilityLabel: string;
  message: string;
  output: TesterTypedOutput;
  trace?: TesterTrace;
};

export type TesterRuntimeInspection =
  | {
      status: 'simulated';
      mode: 'simulated';
      detail: string;
    }
  | {
      status: 'connected' | 'unavailable';
      mode: string;
      detail: string;
    };

export type TesterCapabilityRunInput = {
  capabilityId: TesterCapabilityId;
  prompt: string;
  scenarioId?: string;
  /** Optional live-delta callback forwarded to streaming capabilities. */
  onPartial?: (accumulatedText: string) => void;
  /** Optional local media attachments for vision/multimodal text capabilities. */
  attachments?: BrowserDataUrlAttachment[];
  /** Optional app-composed instruction line (tone/length) prepended to the prompt. */
  directive?: string;
  /** Presence-aware, capability-specific request parameters selected in the workbench. */
  parameters?: TesterCapabilityParameters;
};

export type TesterCapabilityRunResult = TesterTypedSuccess | TesterUnavailable;

export async function inspectRuntimeConnection(): Promise<TesterRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: projection.message,
    };
  }
  return {
    status: 'connected',
    mode: projection.mode,
    detail: 'The protected local-app identity session is bound and Runtime is connected. The App AIConfig selects Local or an exact Cloud implementation; machine selection and execution availability remain Runtime-owned. Text requests run through the canonical Runtime execution path and fail closed with typed reasons when the composed route is not executable.',
  };
}

type TesterRuntimeRunnerSet = {
  readonly aiConsume: typeof runRuntimeAIConsumeCapability;
  readonly imageGenerate: typeof runRuntimeImageGenerate;
  readonly videoGenerate: typeof runRuntimeVideoGenerate;
  readonly speechSynthesize: typeof runRuntimeSpeechSynthesize;
  readonly speechTranscribe: typeof runRuntimeSpeechTranscribe;
  readonly voiceCatalog: typeof runRuntimeVoiceCatalog;
};

export type TesterRuntimeDependencies = {
  readonly getRuntimeProjection?: typeof getRuntimePlatformProjection;
  readonly getLocalAppClient?: () => NimiLocalAppClient;
  readonly createScenarioJobClient?: typeof createNimiLocalAppRuntimeScenarioJobClient;
  readonly runners?: Partial<TesterRuntimeRunnerSet>;
};

const TESTER_RUNTIME_RUNNERS: TesterRuntimeRunnerSet = Object.freeze({
  aiConsume: runRuntimeAIConsumeCapability,
  imageGenerate: runRuntimeImageGenerate,
  videoGenerate: runRuntimeVideoGenerate,
  speechSynthesize: runRuntimeSpeechSynthesize,
  speechTranscribe: runRuntimeSpeechTranscribe,
  voiceCatalog: runRuntimeVoiceCatalog,
});

// The Local App voice carrier derives the real subject from its protected
// session and intentionally does not project that identifier to the App. This
// token exists only to correlate the Kit runner's request/response owner check;
// it never crosses the Local App carrier.
const LOCAL_APP_OWNER_CORRELATION = 'protected-local-app-owner';
const TESTER_RUNTIME_SURFACE_ID = 'tester.ai-capabilities';

type RuntimeStreamEvent = ReturnType<NimiRuntimeAIScenarioClient['streamScenario']> extends AsyncIterable<infer TEvent>
  ? TEvent
  : never;

export async function runTesterCapability(
  input: TesterCapabilityRunInput,
  dependencies: TesterRuntimeDependencies = {},
): Promise<TesterCapabilityRunResult> {
  const capability = getTesterCapability(input.capabilityId);
  const projection = await (dependencies.getRuntimeProjection ?? getRuntimePlatformProjection)();
  if (projection.status !== 'ready') {
    return capabilityUnavailable(capability, 'runtime-unavailable', projection.message);
  }

  const prompt = input.prompt.trim();
  const embeddingInputs = capability.id === 'text.embed'
    ? nonEmptyEmbeddingInputs(input.parameters as TesterEmbeddingParameters | undefined)
    : [];
  const transcribeParameters = capability.id === 'audio.transcribe'
    ? input.parameters as TesterSpeechTranscribeParameters | undefined
    : undefined;
  const voiceCreateParameters = capability.id === 'voice.create'
    ? input.parameters as TesterVoiceCreateParameters | undefined
    : undefined;
  const hasAlternativeInput = embeddingInputs.length > 0
    || Boolean(transcribeParameters?.audioFile)
    || Boolean(voiceCreateParameters?.referenceAudioFile);
  if (capability.id !== 'speech.bundle' && !prompt && !hasAlternativeInput) {
    return capabilityUnavailable(capability, 'input-invalid', `${capability.label} requires non-empty input.`);
  }
  if (transcribeParameters?.audioFile && transcribeParameters.audioFile.sizeBytes > MAX_TESTER_AUDIO_UPLOAD_BYTES) {
    return capabilityUnavailable(capability, 'input-invalid', 'Speech transcription audio files must not exceed 32 MiB.');
  }
  if (capability.id === 'chat.stream' && input.attachments?.length) {
    return capabilityUnavailable(
      capability,
      'input-invalid',
      'The protected Local App text stream currently accepts text messages only.',
    );
  }

  const client = (dependencies.getLocalAppClient ?? getTesterLocalAppClient)();
  const runners = { ...TESTER_RUNTIME_RUNNERS, ...dependencies.runners };
  const scenarioId = input.scenarioId?.trim() || `tester:${capability.id}`;

  try {
    switch (capability.id) {
      case 'text.generate': {
        const parameters = input.parameters as TesterTextGenerationParameters | undefined;
        const result = await client.ai.text.generateCandidate({
          messages: [{ role: 'user', text: prompt }],
          ...textGenerationParameters(parameters),
        });
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: 'Runtime completed the protected foreground text candidate request.',
          output: {
            kind: 'text',
            text: result.text,
            finishReason: result.finishReason,
            streamed: false,
          },
          trace: result.traceId ? { traceId: result.traceId } : undefined,
        };
      }
      case 'chat.stream': {
        const result = await runners.aiConsume({
          runtime: createLocalAppTextScenarioRuntime(client),
          appId,
          capabilityId: 'chat.stream',
          prompt,
          ...(input.directive?.trim() ? { directive: input.directive.trim() } : {}),
          ...(input.parameters ? { parameters: textGenerationParameters(input.parameters as TesterTextGenerationParameters) } : {}),
          scenarioId,
          surfaceId: TESTER_RUNTIME_SURFACE_ID,
          ...(input.onPartial ? { onPartial: input.onPartial } : {}),
        });
        if (result.ok === false) return projectRunnerUnavailable(capability, result);
        if (result.output.kind !== 'text') {
          return capabilityUnavailable(capability, 'runtime-call-failed', 'Runtime stream returned a non-text output.');
        }
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: result.message,
          output: { ...result.output },
          ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
        };
      }
      case 'text.embed': {
        const result = await client.ai.scenario.execute({
          type: 'text-embed',
          inputs: embeddingInputs.length > 0 ? embeddingInputs : [prompt],
        });
        if (result.output.type !== 'text-embed') {
          return capabilityUnavailable(capability, 'runtime-call-failed', 'Runtime embedding returned an unexpected output type.');
        }
        const first = result.output.vectors[0] ?? [];
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: `Runtime completed text.embed with ${result.output.vectors.length} vector(s).`,
          output: {
            kind: 'embedding',
            vectorCount: result.output.vectors.length,
            dimensions: first.length,
            sample: [...first.slice(0, 8)],
          },
          ...(result.traceId ? { trace: { traceId: result.traceId } } : {}),
        };
      }
      case 'image.generate': {
        const parameters = input.parameters as TesterImageGenerationParameters | undefined;
        const result = await runners.imageGenerate({
          runtime: { ai: createTesterScenarioJobClient(client, dependencies) },
          appId,
          prompt,
          ...(parameters?.negativePrompt !== undefined ? { negativePrompt: parameters.negativePrompt } : {}),
          ...(parameters?.count !== undefined ? { count: parameters.count } : {}),
          ...(parameters?.size !== undefined ? { size: parameters.size } : {}),
          ...(parameters?.seed !== undefined ? { seed: parameters.seed } : {}),
          ...(parameters?.aspectRatio !== undefined ? { aspectRatio: parameters.aspectRatio } : {}),
          ...(parameters?.quality !== undefined ? { quality: parameters.quality } : {}),
          ...(parameters?.style !== undefined ? { style: parameters.style } : {}),
          ...(parameters?.referenceImage !== undefined ? { referenceImages: [parameters.referenceImage] } : {}),
          ...(parameters?.referenceImageArtifactId !== undefined ? { referenceImageArtifactId: parameters.referenceImageArtifactId } : {}),
          ...(parameters?.mask !== undefined ? { mask: parameters.mask } : {}),
          scenarioId,
          surfaceId: TESTER_RUNTIME_SURFACE_ID,
        });
        return await projectArtifactRunnerResult(capability, result, client);
      }
      case 'video.generate': {
        const parameters = input.parameters as TesterVideoGenerationParameters | undefined;
        const mode = parameters?.mode ?? 't2v';
        const result = await runners.videoGenerate({
          runtime: { ai: createTesterScenarioJobClient(client, dependencies) },
          appId,
          mode,
          prompt,
          ...(parameters?.negativePrompt !== undefined ? { negativePrompt: parameters.negativePrompt } : {}),
          ...(mode === 'i2v-reference' && parameters?.referenceArtifactId ? {
            content: [{ type: 'artifact-ref', role: 'reference-image', artifactId: parameters.referenceArtifactId }],
          } : {}),
          options: videoGenerationOptions(parameters),
          scenarioId,
          surfaceId: TESTER_RUNTIME_SURFACE_ID,
        });
        return await projectArtifactRunnerResult(capability, result, client);
      }
      case 'audio.synthesize': {
        const parameters = input.parameters as TesterSpeechSynthesizeParameters | undefined;
        const voiceRef = speechVoiceReference(parameters);
        const result = await runners.speechSynthesize({
          runtime: { ai: createTesterScenarioJobClient(client, dependencies) },
          appId,
          text: prompt,
          ...(voiceRef ? { voiceRef } : {}),
          ...(parameters?.language !== undefined ? { language: parameters.language } : {}),
          ...(parameters?.audioFormat !== undefined ? { audioFormat: parameters.audioFormat } : {}),
          ...(parameters?.sampleRateHz !== undefined ? { sampleRateHz: parameters.sampleRateHz } : {}),
          ...(parameters?.speed !== undefined ? { speed: parameters.speed } : {}),
          ...(parameters?.pitch !== undefined ? { pitch: parameters.pitch } : {}),
          ...(parameters?.volume !== undefined ? { volume: parameters.volume } : {}),
          ...(parameters?.emotion !== undefined ? { emotion: parameters.emotion } : {}),
          ...(parameters?.timingMode !== undefined ? { timingMode: parameters.timingMode } : {}),
          scenarioId,
          surfaceId: TESTER_RUNTIME_SURFACE_ID,
        });
        return await projectArtifactRunnerResult(capability, result, client);
      }
      case 'audio.transcribe': {
        const parameters = transcribeParameters;
        const inferredMimeType = prompt ? audioMimeTypeFromUrl(prompt) : null;
        const mimeType = parameters?.mimeType?.trim() || parameters?.audioFile?.mimeType || inferredMimeType;
        if (!mimeType || (!parameters?.audioFile && !isHttpsUrl(prompt))) {
          return capabilityUnavailable(
            capability,
            'input-invalid',
            'Speech transcription requires an HTTPS audio URL with a MIME type or a local audio file up to 32 MiB.',
          );
        }
        const result = await runners.speechTranscribe({
          runtime: { ai: createTesterScenarioJobClient(client, dependencies) },
          appId,
          ...(parameters?.audioFile ? {
            audio: { type: 'bytes' as const, bytes: parameters.audioFile.bytes, mimeType },
          } : { audioUrl: prompt, mimeType }),
          ...(parameters?.language !== undefined ? { language: parameters.language } : {}),
          ...(parameters?.timestamps !== undefined ? { timestamps: parameters.timestamps } : {}),
          ...(parameters?.diarization !== undefined ? { diarization: parameters.diarization } : {}),
          ...(parameters?.speakerCount !== undefined ? { speakerCount: parameters.speakerCount } : {}),
          ...(parameters?.prompt !== undefined ? { prompt: parameters.prompt } : {}),
          ...(parameters?.responseFormat !== undefined ? { responseFormat: parameters.responseFormat } : {}),
          scenarioId,
          surfaceId: TESTER_RUNTIME_SURFACE_ID,
        });
        if (result.ok === false) return projectRunnerUnavailable(capability, result);
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: result.message,
          output: {
            kind: 'transcript',
            text: result.output.text,
            jobId: result.output.jobId,
            jobState: result.output.jobStatus,
            artifactCount: result.output.artifactCount,
          },
          ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
        };
      }
      case 'voice.create': {
        const parameters = voiceCreateParameters;
        const creationSource = parameters?.creationSource ?? 'reference-audio';
        if (creationSource === 'reference-audio') {
          const audio = parameters?.referenceAudioFile;
          if (!audio || audio.sizeBytes === 0 || audio.sizeBytes > MAX_TESTER_VOICE_REFERENCE_AUDIO_BYTES || !audio.mimeType.startsWith('audio/')) {
            return capabilityUnavailable(
              capability,
              'input-invalid',
              'Reference-audio voice creation requires a non-empty audio file up to 20 MiB with an audio MIME type.',
            );
          }
        }
        const submitted = await client.ai.scenarioJobs.submit(creationSource === 'reference-audio'
          ? {
              type: 'voice-create',
              creationSource,
              referenceAudio: { type: 'bytes', bytes: [...parameters!.referenceAudioFile!.bytes] },
              referenceAudioMime: parameters!.referenceAudioFile!.mimeType,
              languageHints: commaSeparatedTokens(parameters?.languageHints),
              preferredName: parameters?.preferredName?.trim() ?? '',
              text: prompt,
            }
          : {
              type: 'voice-create',
              creationSource,
              instructionText: prompt,
              previewText: parameters?.previewText?.trim() ?? '',
              language: parameters?.language?.trim() ?? '',
              preferredName: parameters?.preferredName?.trim() ?? '',
            });
        if (!submitted.job) {
          throw new Error('Runtime voice.create submission must return a Scenario Job.');
        }
        let terminalJob = submitted.job;
        let observedTerminalEvent = false;
        const subscription = await client.ai.scenarioJobs.subscribe(terminalJob.jobId);
        try {
          for await (const event of subscription) {
            if (event.job.jobId !== submitted.job.jobId || event.eventType !== event.job.status) {
              throw new Error('Runtime voice.create Job event did not match the submitted Job.');
            }
            terminalJob = event.job;
            if (isLocalAppJobTerminal(terminalJob.status)) {
              observedTerminalEvent = true;
              break;
            }
          }
        } finally {
          await subscription.cancel().catch(() => undefined);
        }
        if (!observedTerminalEvent) {
          throw new Error('Runtime voice.create Job event stream ended without a terminal event.');
        }
        if (terminalJob.status !== 'completed') {
          throw Object.assign(new Error(terminalJob.reasonDetail || `voice.create ended in ${terminalJob.status}.`), {
            reasonCode: terminalJob.reasonCode,
          });
        }
        const terminalResult = await client.ai.scenarioJobs.get(terminalJob.jobId);
        terminalJob = terminalResult.job;
        if (terminalJob.jobId !== submitted.job.jobId) {
          throw new Error('Runtime voice.create terminal result did not match the submitted Job.');
        }
        if (terminalJob.status !== 'completed') {
          throw new Error('Runtime voice.create terminal result regressed after a COMPLETED event.');
        }
        const resultAsset = terminalResult.asset;
        const voiceReference = terminalResult.voiceReference;
        if (!resultAsset || resultAsset.status !== 'active' || resultAsset.creationSource !== creationSource) {
          throw new Error('Completed voice.create did not return an ACTIVE VoiceAsset with the requested source.');
        }
        if (!voiceReference || voiceReference.kind !== 'voice_asset_id'
          || voiceReference.voiceAssetId !== resultAsset.voiceAssetId) {
          throw new Error('Completed voice.create did not return an exact VoiceAsset reference.');
        }
        const listed = await client.ai.voiceAssets.list({ pageSize: 100 });
        const listedAsset = listed.assets.find((asset) => asset.voiceAssetId === resultAsset.voiceAssetId);
        if (!listedAsset || listedAsset.status !== 'active' || listedAsset.creationSource !== creationSource) {
          throw new Error('Completed voice.create did not project its ACTIVE VoiceAsset through the protected owner catalog.');
        }
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: `Runtime completed voice.create (${creationSource}) and returned a reusable VoiceAsset.`,
          output: {
            kind: 'voice-asset',
            jobId: terminalJob.jobId,
            jobState: terminalJob.status,
            voiceAssetId: listedAsset.voiceAssetId,
            creationSource: listedAsset.creationSource,
            assetStatus: listedAsset.status,
            voiceReference,
          },
          ...(terminalJob.traceId ? { trace: { traceId: terminalJob.traceId } } : {}),
        };
      }
      case 'speech.bundle': {
        const result = await runners.voiceCatalog({
          runtime: createLocalAppVoiceCatalogRuntime(client),
          appId,
          subjectUserId: LOCAL_APP_OWNER_CORRELATION,
        });
        if (result.ok === false) return projectRunnerUnavailable(capability, result);
        return {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: result.message,
          output: {
            kind: 'voice-catalog',
            voiceCount: result.output.voiceCount,
            sample: result.output.voiceReferences.slice(0, 20).map((voice) => ({
              voiceId: voice.voiceAssetId,
              creationSource: VoiceCreationSource[voice.creationSource] || String(voice.creationSource),
              status: VoiceAssetStatus[voice.status] || String(voice.status),
            })),
          },
        };
      }
      case 'world.generate':
        return capabilityUnavailable(capability, 'sdk-method-unavailable', 'World Tour runs through its standalone viewer command.');
    }
  } catch (error) {
    return capabilityUnavailable(capability, 'runtime-call-failed', testerRuntimeErrorMessage(error));
  }
}

function createTesterScenarioJobClient(
  client: NimiLocalAppClient,
  dependencies: TesterRuntimeDependencies,
) {
  return (dependencies.createScenarioJobClient ?? createNimiLocalAppRuntimeScenarioJobClient)(client.ai);
}

function createLocalAppTextScenarioRuntime(client: NimiLocalAppClient): RuntimeAIConsumeRuntime {
  const ai: NimiRuntimeAIScenarioClient = {
    async executeScenario() {
      throw Object.assign(new Error('Local App text execution is stream-only on this adapter.'), {
        reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      });
    },
    streamScenario(request, options) {
      return streamLocalAppTextEvents(client, request, options?.signal);
    },
  };
  return { ai };
}

async function* streamLocalAppTextEvents(
  client: NimiLocalAppClient,
  request: Parameters<NimiRuntimeAIScenarioClient['streamScenario']>[0],
  signal?: AbortSignal,
): AsyncIterable<RuntimeStreamEvent> {
  const spec = request.spec?.spec;
  if (
    request.scenarioType !== ScenarioType.TEXT_GENERATE
    || request.executionMode !== ExecutionMode.STREAM
    || request.extensions.length > 0
    || spec?.oneofKind !== 'textGenerate'
  ) {
    throw Object.assign(new Error('Local App text stream requires the closed textGenerate Scenario shape.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  const textSpec = spec.textGenerate;
  if (
    textSpec.tools.length > 0
    || textSpec.toolChoiceName
    || textSpec.input.some((message) => message.role !== 'user')
  ) {
    throw Object.assign(new Error('Local App text stream does not admit tools or advanced generation controls.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  const messages = [
    ...(textSpec.systemPrompt ? [{ role: 'system' as const, text: textSpec.systemPrompt }] : []),
    ...textSpec.input.map((message) => ({ role: 'user' as const, text: message.content })),
  ];
  const seed = localTextSeed(textSpec.seed);
  const subscription = await client.ai.text.streamTurn({
    messages,
    ...(textSpec.temperature !== undefined ? { temperature: textSpec.temperature } : {}),
    ...(textSpec.topP !== undefined ? { topP: textSpec.topP } : {}),
    ...(textSpec.maxTokens !== undefined ? { maxTokens: textSpec.maxTokens } : {}),
    ...(textSpec.topK !== undefined ? { topK: textSpec.topK } : {}),
    ...(textSpec.presencePenalty !== undefined ? { presencePenalty: textSpec.presencePenalty } : {}),
    ...(textSpec.frequencyPenalty !== undefined ? { frequencyPenalty: textSpec.frequencyPenalty } : {}),
    ...(textSpec.stop.length > 0 ? { stop: [...textSpec.stop] } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    void subscription.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    let started = false;
    for await (const event of subscription) {
      if (!started) {
        started = true;
        yield {
          eventType: 1,
          sequence: event.sequence,
          traceId: event.traceId,
          payload: {
            oneofKind: 'started',
            started: { modelResolved: '', routeDecision: 0, voiceOutputMode: 0 },
          },
        };
      }
      if (event.type === 'delta') {
        yield localTextDeltaEvent(event);
        continue;
      }
      if (event.type === 'failed') {
        throw Object.assign(new Error(event.actionHint || 'Runtime Scenario stream failed.'), {
          reasonCode: event.reasonCode,
          actionHint: event.actionHint,
        });
      }
      yield {
        eventType: 6,
        sequence: event.sequence,
        traceId: event.traceId,
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: localFinishReason(event.finishReason),
            streamSimulated: false,
          },
        },
      };
      return;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

function localTextSeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) {
    throw Object.assign(new Error('Local App text seed must be a safe integer.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  return seed;
}

function localTextDeltaEvent(event: Extract<NimiLocalAppTextTurnEvent, { type: 'delta' }>): RuntimeStreamEvent {
  return {
    eventType: 2,
    sequence: event.sequence,
    traceId: event.traceId,
    payload: {
      oneofKind: 'delta',
      delta: { delta: { oneofKind: 'text', text: { text: event.text } } },
    },
  };
}

function localFinishReason(reason: Extract<NimiLocalAppTextTurnEvent, { type: 'completed' }>['finishReason']): FinishReason {
  if (reason === 'length') return FinishReason.LENGTH;
  if (reason === 'content-filter') return FinishReason.CONTENT_FILTER;
  return FinishReason.STOP;
}

function createLocalAppVoiceCatalogRuntime(client: NimiLocalAppClient): RuntimeVoiceCatalogRuntime {
  return {
    ai: {
      async listVoiceAssets(request) {
        const result = await client.ai.voiceAssets.list({
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

type ArtifactRunnerResult = Awaited<ReturnType<
  | typeof runRuntimeImageGenerate
  | typeof runRuntimeVideoGenerate
  | typeof runRuntimeSpeechSynthesize
>>;
async function projectArtifactRunnerResult(
  capability: TesterCapability,
  result: ArtifactRunnerResult,
  client: NimiLocalAppClient,
): Promise<TesterCapabilityRunResult> {
  if (result.ok === false) return projectRunnerUnavailable(capability, result);
  const artifacts: TesterManagedArtifact[] = [];
  const adoptedPaths: string[] = [];
  try {
    for (const [index, sourceArtifact] of result.output.artifacts.entries()) {
      if (!sourceArtifact.artifactId) {
        throw new Error('Runtime artifact metadata omitted the custody artifact identifier required for adoption.');
      }
      const relativePath = await managedAssetPath(capability.id, result.output.jobId, index);
      const adopted = await client.storage.assets.adoptArtifact({
        artifactId: sourceArtifact.artifactId,
        relativePath,
        overwrite: false,
      });
      adoptedPaths.push(adopted.relativePath);
      artifacts.push({
        relativePath: adopted.relativePath,
        ...(adopted.mediaType ? { mediaType: adopted.mediaType } : {}),
        sizeBytes: adopted.sizeBytes,
        sha256: adopted.sha256,
        displayName: index === 0 ? capability.label : `${capability.label} ${index + 1}`,
        previewSource: 'managed-asset',
      });
    }
  } catch (error) {
    const cleanupFailures: string[] = [];
    for (const relativePath of [...adoptedPaths].reverse()) {
      try {
        await client.storage.assets.remove(relativePath);
      } catch (cleanupError) {
        cleanupFailures.push(`${relativePath}: ${testerRuntimeErrorMessage(cleanupError)}`);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`${testerRuntimeErrorMessage(error)} Managed artifact cleanup also failed: ${cleanupFailures.join('; ')}`);
    }
    throw error;
  }
  return {
    ok: true,
    capabilityId: capability.id,
    capabilityLabel: capability.label,
    message: result.message,
    output: {
      kind: 'artifacts',
      jobId: result.output.jobId,
      jobState: result.output.jobStatus,
      artifactCount: result.output.artifactCount,
      artifacts,
      ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
    },
    ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
  };
}

async function managedAssetPath(capabilityId: TesterCapabilityId, jobId: string, artifactIndex: number): Promise<string> {
  const identity = artifactIndex === 0 ? jobId : `${jobId}:${artifactIndex}`;
  const bytes = new TextEncoder().encode(identity);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const token = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `media/${capabilityId.replaceAll('.', '-')}/${token}.asset`;
}

function projectRunnerUnavailable(
  capability: TesterCapability,
  result: { readonly ok: false; readonly reason: string; readonly message: string },
): TesterUnavailable {
  return capabilityUnavailable(capability, testerUnavailableReason(result.reason), result.message);
}

function testerUnavailableReason(reason: string): TesterUnavailableReason {
  if (reason === 'input-invalid' || reason === 'sdk-method-unavailable'
    || reason === 'principal-unauthorized' || reason === 'runtime-canceled') {
    return reason;
  }
  return 'runtime-call-failed';
}

function textGenerationParameters(parameters: TesterTextGenerationParameters | undefined): TesterTextGenerationParameters {
  if (!parameters) return {};
  return {
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { topP: parameters.topP } : {}),
    ...(parameters.maxTokens !== undefined ? { maxTokens: parameters.maxTokens } : {}),
    ...(parameters.topK !== undefined ? { topK: parameters.topK } : {}),
    ...(parameters.presencePenalty !== undefined ? { presencePenalty: parameters.presencePenalty } : {}),
    ...(parameters.frequencyPenalty !== undefined ? { frequencyPenalty: parameters.frequencyPenalty } : {}),
    ...(parameters.stop !== undefined ? { stop: [...parameters.stop] } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
  };
}

function videoGenerationOptions(parameters: TesterVideoGenerationParameters | undefined) {
  if (!parameters) return undefined;
  return {
    ...(parameters.resolution !== undefined ? { resolution: parameters.resolution } : {}),
    ...(parameters.ratio !== undefined ? { ratio: parameters.ratio } : {}),
    ...(parameters.durationSec !== undefined ? { durationSec: parameters.durationSec } : {}),
    ...(parameters.frames !== undefined ? { frames: parameters.frames } : {}),
    ...(parameters.fps !== undefined ? { fps: parameters.fps } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters.cameraFixed !== undefined ? { cameraFixed: parameters.cameraFixed } : {}),
    ...(parameters.watermark !== undefined ? { watermark: parameters.watermark } : {}),
    ...(parameters.generateAudio !== undefined ? { generateAudio: parameters.generateAudio } : {}),
    ...(parameters.draft !== undefined ? { draft: parameters.draft } : {}),
    ...(parameters.serviceTier !== undefined ? { serviceTier: parameters.serviceTier } : {}),
    ...(parameters.executionExpiresAfterSec !== undefined ? { executionExpiresAfterSec: parameters.executionExpiresAfterSec } : {}),
    ...(parameters.returnLastFrame !== undefined ? { returnLastFrame: parameters.returnLastFrame } : {}),
  };
}

function speechVoiceReference(parameters: TesterSpeechSynthesizeParameters | undefined) {
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

function isLocalAppJobTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timeout';
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function testerRuntimeErrorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const message = error instanceof Error ? error.message.trim() : '';
  const reasonCode = typeof record?.reasonCode === 'string' ? record.reasonCode.trim() : '';
  if (message && reasonCode) return `${message} (${reasonCode})`;
  return message || reasonCode || String(error || 'The Runtime capability call failed.');
}
