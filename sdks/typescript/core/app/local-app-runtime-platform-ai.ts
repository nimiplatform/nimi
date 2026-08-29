import {
  ExecutionMode,
  FinishReason,
  ReasonCode as RuntimeReasonCode,
  RoutePolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  VoiceAssetStatus,
  VoiceCreationSource,
  VoiceReferenceKind,
  type CancelLocalAppScenarioJobRequest,
  type CancelLocalAppScenarioJobResponse,
  type ExecuteLocalAppScenarioRequest,
  type ExecuteLocalAppScenarioResponse,
  type GetLocalAppScenarioJobRequest,
  type GetLocalAppScenarioJobResponse,
  type GetScenarioArtifactsResponse,
  type ListLocalAppVoiceAssetsRequest,
  type ListLocalAppVoiceAssetsResponse,
  type LocalAppVoiceAsset,
  type LocalAppScenarioJob,
  type LocalAppScenarioJobEvent,
  type ReadLocalAppArtifactRequest,
  type ReadLocalAppArtifactResponse,
  type RuntimeTypedCallOptions,
  type ScenarioArtifact,
  type ScenarioJob,
  type ScenarioJobEvent,
  type ScenarioOutput,
  type ScenarioSpec,
  type SubmitScenarioJobRequest,
  type StreamLocalAppTextTurnEvent,
  type StreamLocalAppTextTurnRequest,
  type SubmitLocalAppScenarioJobRequest,
  type SubmitLocalAppScenarioJobResponse,
  type SubscribeLocalAppScenarioJobEventsRequest,
  type UploadLocalAppArtifactRequest,
  type UploadLocalAppArtifactResponse,
  type VoiceReference,
} from '../../core-generated/runtime-typed-client.js';
import type { Timestamp } from '../../core-generated/runtime-protobuf/google/protobuf/timestamp.js';
import type {
  NimiProtectedLocalScenarioJobClient,
  NimiProtectedLocalVoiceAsset,
} from '../../runtime/scenario-jobs.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation.js';
import type { NimiLocalAppTextCandidateInput } from './local-app-runtime-platform.js';

export type NimiLocalAppImageGenerateSpec = {
  readonly type: 'image-generate';
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly n?: number;
  readonly size: string;
  readonly aspectRatio: string;
  readonly quality: string;
  readonly style: string;
  readonly seed?: number;
  readonly referenceImages: readonly string[];
  readonly referenceImageArtifactId: string;
  readonly mask: string;
  readonly responseFormat: '' | 'b64_json' | 'url';
};

export type NimiLocalAppScenarioExecuteSpec =
  | { readonly type: 'text-embed'; readonly inputs: readonly string[] }
  | NimiLocalAppImageGenerateSpec;

export type NimiLocalAppVideoContentRole =
  | 'prompt'
  | 'first-frame'
  | 'last-frame'
  | 'reference-image'
  | 'reference-video'
  | 'reference-audio';

export type NimiLocalAppVideoContent =
  | { readonly type: 'text'; readonly role: NimiLocalAppVideoContentRole; readonly text: string }
  | { readonly type: 'image-url' | 'video-url' | 'audio-url'; readonly role: NimiLocalAppVideoContentRole; readonly url: string }
  | { readonly type: 'artifact-ref'; readonly role: NimiLocalAppVideoContentRole; readonly artifactId: string };

export type NimiLocalAppScenarioJobSpec =
  | NimiLocalAppImageGenerateSpec
  | {
      readonly type: 'video-generate';
      readonly prompt: string;
      readonly negativePrompt: string;
      readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
      readonly content: readonly NimiLocalAppVideoContent[];
      readonly options: {
        readonly resolution: string;
        readonly ratio: string;
        readonly durationSec?: number;
        readonly frames?: number;
        readonly fps?: number;
        readonly seed?: number;
        readonly cameraFixed?: boolean;
        readonly watermark?: boolean;
        readonly generateAudio?: boolean;
        readonly draft?: boolean;
        readonly returnLastFrame?: boolean;
      };
    }
  | {
      readonly type: 'speech-synthesize';
      readonly text: string;
      readonly language: string;
      readonly audioFormat: string;
      readonly sampleRateHz?: number;
      readonly speed?: number;
      readonly pitch?: number;
      readonly volume?: number;
      readonly emotion: string;
      readonly voiceRef: { readonly type: 'preset' | 'voice-asset'; readonly id: string } | null;
      readonly timingMode: 'none' | 'word' | 'char';
      readonly voiceRenderHints: {
        readonly stability: number;
        readonly similarityBoost: number;
        readonly style: number;
        readonly useSpeakerBoost: boolean;
        readonly speed: number;
      } | null;
    }
  | {
      readonly type: 'speech-transcribe';
      readonly mimeType: string;
      readonly language: string;
      readonly timestamps?: boolean;
      readonly diarization?: boolean;
      readonly speakerCount?: number;
      readonly prompt: string;
      readonly responseFormat: string;
      readonly audioSource:
        | { readonly type: 'bytes'; readonly bytes: readonly number[] }
        | { readonly type: 'uri'; readonly uri: string };
    }
  | {
      readonly type: 'voice-create';
      readonly creationSource: 'reference-audio';
      readonly referenceAudio:
        | { readonly type: 'bytes'; readonly bytes: readonly number[] }
        | { readonly type: 'uri'; readonly uri: string };
      readonly referenceAudioMime: string;
      readonly languageHints: readonly string[];
      readonly preferredName: string;
      readonly text: string;
    }
  | {
      readonly type: 'voice-create';
      readonly creationSource: 'text-description';
      readonly instructionText: string;
      readonly previewText: string;
      readonly language: string;
      readonly preferredName: string;
    }
  | {
      readonly type: 'music-generate';
      readonly prompt: string;
      readonly lyrics: string;
    };

export type NimiLocalAppScenarioJobSubmitOptions = {
  readonly timeoutMs?: number;
};

export type NimiLocalAppScenarioTimestamp = {
  readonly seconds: string;
  readonly nanos: number;
};

export type NimiLocalAppScenarioArtifact = {
  readonly artifactId: string;
  readonly mimeType: string;
  readonly bytes: readonly number[];
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly sampleRateHz: number;
  readonly channels: number;
};

export type NimiLocalAppScenarioJob = {
  readonly jobId: string;
  readonly scenarioType: 'image-generate' | 'video-generate' | 'speech-synthesize' | 'speech-transcribe' | 'voice-create' | 'music-generate';
  readonly status: 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'timeout';
  readonly progressPercent: number;
  readonly progressCurrentStep: number;
  readonly progressTotalSteps: number;
  readonly reasonCode: string;
  readonly reasonDetail: string;
  readonly artifacts: readonly NimiLocalAppScenarioArtifact[];
  readonly traceId: string;
  readonly createdAt: NimiLocalAppScenarioTimestamp | null;
  readonly updatedAt: NimiLocalAppScenarioTimestamp | null;
  readonly transcriptionText: string;
};

export type NimiLocalAppVoiceAsset = {
  readonly voiceAssetId: string;
  readonly creationSource: 'reference-audio' | 'text-description';
  readonly status: 'active' | 'expired' | 'deleted' | 'failed';
  readonly createdAt: NimiLocalAppScenarioTimestamp | null;
  readonly updatedAt: NimiLocalAppScenarioTimestamp | null;
  readonly expiresAt: NimiLocalAppScenarioTimestamp | null;
};

export type NimiLocalAppScenarioExecuteResult =
  | { readonly output: { readonly type: 'text-embed'; readonly vectors: readonly (readonly number[])[] }; readonly traceId: string }
  | { readonly output: { readonly type: 'image-generate'; readonly artifacts: readonly NimiLocalAppScenarioArtifact[] }; readonly traceId: string };

export type NimiLocalAppScenarioJobSubmitResult = {
  readonly job: NimiLocalAppScenarioJob;
};

export type NimiLocalAppScenarioJobGetResult = {
  readonly job: NimiLocalAppScenarioJob;
  readonly asset: NimiLocalAppVoiceAsset | null;
  readonly voiceReference: { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string } | null;
};

export type NimiLocalAppArtifactImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export type NimiLocalAppArtifactUploadResult = {
  readonly artifactId: string;
  readonly sizeBytes: number;
  readonly mimeType: NimiLocalAppArtifactImageMime;
};

export type NimiLocalAppTextTurnEvent =
  | { readonly type: 'delta'; readonly sequence: string; readonly traceId: string; readonly text: string }
  | { readonly type: 'completed'; readonly sequence: string; readonly traceId: string; readonly finishReason: 'stop' | 'length' | 'content-filter' }
  | { readonly type: 'failed'; readonly sequence: string; readonly traceId: string; readonly reasonCode: string; readonly actionHint: string };

export type NimiLocalAppScenarioJobEvent = {
  readonly eventType: 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'timeout';
  readonly sequence: string;
  readonly traceId: string;
  readonly timestamp: NimiLocalAppScenarioTimestamp | null;
  readonly job: NimiLocalAppScenarioJob;
};

export type NimiLocalAppSubscription<T> = AsyncIterable<T> & {
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppShellStream<T> = {
  readonly events: AsyncIterable<T>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppAIConsumptionShell = {
  readonly text: {
    readonly streamTurn: (input: NimiLocalAppTextCandidateInput) => Promise<NimiLocalAppShellStream<unknown>>;
  };
  readonly scenario: {
    readonly execute: (spec: NimiLocalAppScenarioExecuteSpec) => Promise<unknown>;
  };
  readonly scenarioJobs: {
    readonly submit: (
      spec: NimiLocalAppScenarioJobSpec,
      options?: NimiLocalAppScenarioJobSubmitOptions,
    ) => Promise<unknown>;
    readonly get: (jobId: string) => Promise<unknown>;
    readonly subscribe: (jobId: string) => Promise<NimiLocalAppShellStream<unknown>>;
    readonly cancel: (jobId: string, reason?: string) => Promise<unknown>;
  };
  readonly artifacts: {
    readonly read: (artifactId: string) => Promise<unknown>;
    readonly upload: (input: { readonly bytes: readonly number[]; readonly mimeType: NimiLocalAppArtifactImageMime }) => Promise<unknown>;
  };
  readonly voiceAssets: NimiLocalAppVoiceAssetsShell;
};

export type NimiLocalAppVoiceAssetsListInput = {
  readonly pageSize?: number;
  readonly pageToken?: string;
};

export type NimiLocalAppVoiceAssetsListResult = {
  readonly assets: readonly NimiLocalAppVoiceAsset[];
  readonly nextPageToken: string;
};

export type NimiLocalAppVoiceAssetsShell = {
  readonly list: (input?: NimiLocalAppVoiceAssetsListInput) => Promise<unknown>;
};

export type NimiLocalAppVoiceAssetsClient = {
  readonly list: (input?: NimiLocalAppVoiceAssetsListInput) => Promise<NimiLocalAppVoiceAssetsListResult>;
};

export type NimiLocalAppVoiceAssetsRuntime = {
  readonly listLocalAppVoiceAssets: (
    request: ListLocalAppVoiceAssetsRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<ListLocalAppVoiceAssetsResponse>;
};

export type NimiLocalAppAIConsumptionClient = {
  readonly text: {
    readonly streamTurn: (input: NimiLocalAppTextCandidateInput) => Promise<NimiLocalAppSubscription<NimiLocalAppTextTurnEvent>>;
  };
  readonly scenario: {
    readonly execute: (spec: NimiLocalAppScenarioExecuteSpec) => Promise<NimiLocalAppScenarioExecuteResult>;
  };
  readonly scenarioJobs: {
    readonly submit: (
      spec: NimiLocalAppScenarioJobSpec,
      options?: NimiLocalAppScenarioJobSubmitOptions,
    ) => Promise<NimiLocalAppScenarioJobSubmitResult>;
    readonly get: (jobId: string) => Promise<NimiLocalAppScenarioJobGetResult>;
    readonly subscribe: (jobId: string) => Promise<NimiLocalAppSubscription<NimiLocalAppScenarioJobEvent>>;
    readonly cancel: (jobId: string, reason?: string) => Promise<{ readonly job: NimiLocalAppScenarioJob }>;
  };
  readonly artifacts: {
    readonly read: (artifactId: string) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string; readonly sizeBytes: number }>;
    readonly upload: (input: { readonly bytes: Uint8Array; readonly mimeType: NimiLocalAppArtifactImageMime }) => Promise<NimiLocalAppArtifactUploadResult>;
  };
  readonly voiceAssets: NimiLocalAppVoiceAssetsClient;
};

export type NimiLocalAppAIConsumptionRuntime = {
  readonly streamLocalAppTextTurn: (
    request: StreamLocalAppTextTurnRequest,
    options?: RuntimeTypedCallOptions,
  ) => AsyncIterable<StreamLocalAppTextTurnEvent>;
  readonly executeLocalAppScenario: (
    request: ExecuteLocalAppScenarioRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<ExecuteLocalAppScenarioResponse>;
  readonly submitLocalAppScenarioJob: (
    request: SubmitLocalAppScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<SubmitLocalAppScenarioJobResponse>;
  readonly getLocalAppScenarioJob: (
    request: GetLocalAppScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<GetLocalAppScenarioJobResponse>;
  readonly subscribeLocalAppScenarioJobEvents: (
    request: SubscribeLocalAppScenarioJobEventsRequest,
    options?: RuntimeTypedCallOptions,
  ) => AsyncIterable<LocalAppScenarioJobEvent>;
  readonly cancelLocalAppScenarioJob: (
    request: CancelLocalAppScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<CancelLocalAppScenarioJobResponse>;
  readonly readLocalAppArtifact: (
    request: ReadLocalAppArtifactRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<ReadLocalAppArtifactResponse>;
  readonly uploadLocalAppArtifact: (
    request: UploadLocalAppArtifactRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<UploadLocalAppArtifactResponse>;
  readonly listLocalAppVoiceAssets: NimiLocalAppVoiceAssetsRuntime['listLocalAppVoiceAssets'];
};

const MAX_RESULT_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_IDENTIFIER_BYTES = 128;

// @nimi-authority: rule.nimi.sdks.feature-clients.r101
// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export function createNimiLocalAppAIConsumptionClient(
  shell: NimiLocalAppAIConsumptionShell,
): NimiLocalAppAIConsumptionClient {
  const voiceAssets = createNimiLocalAppVoiceAssetsClient(shell.voiceAssets);
  const client: NimiLocalAppAIConsumptionClient = {
    text: Object.freeze({
      streamTurn: async (input) => {
        let resultBytes = 0;
        return projectSubscription(
          await shell.text.streamTurn(validateTextTurnInput(input)),
          (value) => {
            const event = projectTextTurnEvent(value);
            if (event.type === 'delta') {
              resultBytes += utf8Length(event.text);
              if (resultBytes > MAX_RESULT_BYTES) localAppProjectionError('text-turn result size');
            }
            return event;
          },
        );
      },
    }),
    scenario: Object.freeze({
      execute: async (spec) => projectScenarioExecute(
        await shell.scenario.execute(validateScenarioSpec(spec, true)),
      ),
    }),
    scenarioJobs: Object.freeze({
      submit: async (spec, options = {}) => projectScenarioJobSubmit(
        await shell.scenarioJobs.submit(
          validateScenarioSpec(spec, false),
          validateScenarioJobSubmitOptions(options),
        ),
      ),
      get: async (jobId) => projectScenarioJobGet(
        await shell.scenarioJobs.get(boundedIdentifier(jobId, 'jobId')),
      ),
      subscribe: async (jobId) => projectSubscription(
        await shell.scenarioJobs.subscribe(boundedIdentifier(jobId, 'jobId')),
        projectScenarioJobEvent,
      ),
      cancel: async (jobId, reason = '') => {
        if (typeof reason !== 'string' || reason.trim() !== reason || utf8Length(reason) > 512 || hasControl(reason)) {
          invalidAIInput('cancel reason is invalid');
        }
        return projectScenarioJobEnvelope(
          await shell.scenarioJobs.cancel(boundedIdentifier(jobId, 'jobId'), reason),
        );
      },
    }),
    artifacts: Object.freeze({
      read: async (artifactId) => projectArtifactRead(
        await shell.artifacts.read(boundedIdentifier(artifactId, 'artifactId')),
      ),
      upload: async (input) => {
        assertExactKeys(input, ['bytes', 'mimeType'], 'artifact upload input');
        assertNoAuthorityMaterial(input);
        if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0
          || input.bytes.byteLength > MAX_ARTIFACT_BYTES || !isArtifactImageMime(input.mimeType)) {
          invalidAIInput('artifact upload is invalid');
        }
        return projectArtifactUpload(
          await shell.artifacts.upload({ bytes: [...input.bytes], mimeType: input.mimeType }),
          input.bytes.byteLength,
          input.mimeType,
        );
      },
    }),
    voiceAssets,
  };
  return Object.freeze(client);
}

// Host composition uses this adapter to project the exact Local App Runtime
// operation family through the same public client as every standard shell.
// It does not admit Runtime-private Scenario fields or caller-selected routes.
// @nimi-authority: rule.nimi.sdks.feature-clients.r101
export function createNimiLocalAppAIConsumptionRuntimeClient(
  runtime: NimiLocalAppAIConsumptionRuntime,
): NimiLocalAppAIConsumptionClient {
  const voiceAssets = createNimiLocalAppVoiceAssetsRuntimeClient(runtime);
  return createNimiLocalAppAIConsumptionClient({
    text: {
      async streamTurn(input) {
        const controller = new AbortController();
        const source = runtime.streamLocalAppTextTurn(runtimeTextTurnRequest(input), {
          signal: controller.signal,
        });
        return {
          events: (async function* () {
            for await (const event of source) yield projectRuntimeTextTurnEvent(event);
          })(),
          cancel: async () => controller.abort(),
        };
      },
    },
    scenario: {
      async execute(spec) {
        const response = await runtime.executeLocalAppScenario(runtimeExecuteRequest(spec));
        return projectRuntimeScenarioExecuteResponse(response);
      },
    },
    scenarioJobs: {
      async submit(spec, options = {}) {
        const response = await runtime.submitLocalAppScenarioJob({
          spec: runtimeLocalJobSpec(spec),
          timeoutMs: options.timeoutMs ?? 0,
        });
        return { job: projectRuntimeLocalJob(requiredRuntimeValue(response.job, 'scenario Job')) };
      },
      async get(jobId) {
        const response = await runtime.getLocalAppScenarioJob({ jobId });
        return {
          job: projectRuntimeLocalJob(requiredRuntimeValue(response.job, 'scenario Job')),
          asset: response.asset ? projectRuntimeLocalAppVoiceAsset(response.asset) : null,
          voiceReference: response.voiceReference
            ? projectRuntimeVoiceReference(response.voiceReference)
            : null,
        };
      },
      async subscribe(jobId) {
        const controller = new AbortController();
        const source = runtime.subscribeLocalAppScenarioJobEvents({ jobId }, {
          signal: controller.signal,
        });
        return {
          events: (async function* () {
            for await (const event of source) yield projectRuntimeLocalJobEvent(event);
          })(),
          cancel: async () => controller.abort(),
        };
      },
      async cancel(jobId, reason = '') {
        const response = await runtime.cancelLocalAppScenarioJob({ jobId, reason });
        return { job: projectRuntimeLocalJob(requiredRuntimeValue(response.job, 'scenario Job')) };
      },
    },
    artifacts: {
      async read(artifactId) {
        const response = await runtime.readLocalAppArtifact({ artifactId });
        return {
          bytes: Array.from(response.bytes),
          mimeType: response.mimeType,
          sizeBytes: runtimeSafeInteger(response.sizeBytes, 'artifact size'),
        };
      },
      async upload(input) {
        const response = await runtime.uploadLocalAppArtifact({
          bytes: Uint8Array.from(input.bytes),
          mimeType: input.mimeType,
        });
        return {
          artifactId: response.artifactId,
          sizeBytes: runtimeSafeInteger(response.sizeBytes, 'artifact size'),
          mimeType: response.mimeType,
        };
      },
    },
    voiceAssets: {
      list: (input) => voiceAssets.list(input),
    },
  });
}

export function createNimiLocalAppVoiceAssetsClient(
  shell: NimiLocalAppVoiceAssetsShell,
): NimiLocalAppVoiceAssetsClient {
  return createNimiLocalAppVoiceAssetsProjector((input) => shell.list(input));
}

export function createNimiLocalAppVoiceAssetsRuntimeClient(
  runtime: NimiLocalAppVoiceAssetsRuntime,
): NimiLocalAppVoiceAssetsClient {
  return createNimiLocalAppVoiceAssetsProjector(async (input) => {
    const response = await runtime.listLocalAppVoiceAssets({
      pageSize: input.pageSize ?? 0,
      pageToken: input.pageToken ?? '',
    });
    return {
      assets: response.assets.map(projectRuntimeLocalAppVoiceAsset),
      nextPageToken: response.nextPageToken,
    };
  });
}

function createNimiLocalAppVoiceAssetsProjector(
  list: (input: Readonly<{ pageSize: number; pageToken: string }>) => Promise<unknown>,
): NimiLocalAppVoiceAssetsClient {
  return Object.freeze({
    async list(input: NimiLocalAppVoiceAssetsListInput = {}) {
      const page = validateVoiceAssetsListInput(input);
      return projectVoiceAssetsList(await list(page));
    },
  });
}

function validateVoiceAssetsListInput(
  input: NimiLocalAppVoiceAssetsListInput,
): Readonly<{ pageSize: number; pageToken: string }> {
  assertExactKeys(input, ['pageSize', 'pageToken'], 'voice asset list input');
  assertNoAuthorityMaterial(input);
  const pageSize = input.pageSize ?? 0;
  const pageToken = input.pageToken ?? '';
  if (!Number.isSafeInteger(pageSize) || pageSize < 0 || pageSize > 200
    || typeof pageToken !== 'string' || !/^[0-9]{0,10}$/u.test(pageToken)) {
    invalidAIInput('voice asset page is invalid');
  }
  return Object.freeze({ pageSize, pageToken });
}

export function createNimiLocalAppRuntimeScenarioJobClient(
  ai: Pick<NimiLocalAppAIConsumptionClient, 'scenarioJobs' | 'artifacts'>,
): NimiProtectedLocalScenarioJobClient {
  const client: NimiProtectedLocalScenarioJobClient = {
    terminalVoiceAssetProjection: 'protected-local',
    async submitScenarioJob(request) {
      const spec = localJobSpecFromRuntimeRequest(request);
      const result = await ai.scenarioJobs.submit(spec, {
        timeoutMs: boundedInteger(request.head?.timeoutMs ?? 0, 'Scenario Job timeoutMs', 0, 2_147_483_647),
      });
      return {
        job: runtimeJobFromLocal(result.job),
      };
    },
    async getScenarioJob(request) {
      assertExactKeys(request, ['jobId'], 'local-app Scenario Job get request');
      const result = await ai.scenarioJobs.get(request.jobId);
      return {
        job: runtimeJobFromLocal(result.job),
        asset: result.asset ? runtimeVoiceAssetFromLocal(result.asset) : undefined,
        voiceReference: result.voiceReference ? {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: {
            oneofKind: 'voiceAssetId',
            voiceAssetId: result.voiceReference.voiceAssetId,
          },
        } : undefined,
      };
    },
    async cancelScenarioJob(request) {
      assertExactKeys(request, ['jobId', 'reason'], 'local-app Scenario Job cancel request');
      const result = await ai.scenarioJobs.cancel(request.jobId, request.reason);
      return { job: runtimeJobFromLocal(result.job) };
    },
    subscribeScenarioJobEvents(request) {
      assertExactKeys(request, ['jobId'], 'local-app Scenario Job subscribe request');
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<ScenarioJobEvent> {
          const subscription = await ai.scenarioJobs.subscribe(request.jobId);
          try {
            for await (const event of subscription) {
              yield runtimeJobEventFromLocal(event);
            }
          } finally {
            await subscription.cancel();
          }
        },
      };
    },
    async getScenarioArtifacts(request) {
      assertExactKeys(request, ['jobId'], 'local-app Scenario artifact request');
      const { job } = await ai.scenarioJobs.get(request.jobId);
      const artifacts = job.artifacts.map((artifact) => runtimeArtifactFromLocal(artifact));
      return runtimeArtifactResponse(job, artifacts);
    },
  };
  return Object.freeze(client);
}

function validateTextTurnInput(input: NimiLocalAppTextCandidateInput): NimiLocalAppTextCandidateInput {
  assertExactKeys(input, [
    'messages', 'temperature', 'topP', 'maxTokens', 'topK',
    'presencePenalty', 'frequencyPenalty', 'stop', 'seed',
  ], 'text-turn input');
  assertNoAuthorityMaterial(input);
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > 8) {
    invalidAIInput('text-turn messages are invalid');
  }
  let totalBytes = 0;
  let sawSystem = false;
  let sawUser = false;
  const messages = input.messages.map((message, index) => {
    assertExactKeys(message, ['role', 'text'], `text-turn message ${index}`);
    if (message.role === 'system') {
      if (sawSystem || sawUser) invalidAIInput('text-turn system message order is invalid');
      sawSystem = true;
    } else if (message.role === 'user') sawUser = true;
    else invalidAIInput(`text-turn message ${index} role is invalid`);
    const text = boundedContent(message.text, `text-turn message ${index}`, 32 * 1024);
    totalBytes += utf8Length(message.role) + utf8Length(text);
    if (totalBytes > 64 * 1024) invalidAIInput('text-turn prompt is too large');
    return Object.freeze({ role: message.role, text });
  });
  if (!sawUser) invalidAIInput('text-turn requires a user message');
  optionalBoundedNumber(input.temperature, 'text-turn temperature', 0, 2);
  optionalBoundedNumber(input.topP, 'text-turn topP', 0, 1);
  optionalBoundedInteger(input.maxTokens, 'text-turn maxTokens', 0, 4096);
  optionalBoundedInteger(input.topK, 'text-turn topK', 0, Number.MAX_SAFE_INTEGER);
  optionalBoundedNumber(input.presencePenalty, 'text-turn presencePenalty', -2, 2);
  optionalBoundedNumber(input.frequencyPenalty, 'text-turn frequencyPenalty', -2, 2);
  optionalBoundedInteger(input.seed, 'text-turn seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (input.stop !== undefined && (!Array.isArray(input.stop)
    || input.stop.some((entry) => typeof entry !== 'string' || !entry.trim()))) invalidAIInput('text-turn stop is invalid');
  return Object.freeze({
    messages: Object.freeze(messages),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.topP !== undefined ? { topP: input.topP } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.topK !== undefined ? { topK: input.topK } : {}),
    ...(input.presencePenalty !== undefined ? { presencePenalty: input.presencePenalty } : {}),
    ...(input.frequencyPenalty !== undefined ? { frequencyPenalty: input.frequencyPenalty } : {}),
    ...(input.stop !== undefined ? { stop: Object.freeze([...input.stop]) } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });
}

function validateScenarioSpec<T extends NimiLocalAppScenarioExecuteSpec | NimiLocalAppScenarioJobSpec>(
  spec: T,
  execute: boolean,
): T {
  const record = asRecord(spec);
  if (!record || typeof record.type !== 'string') invalidAIInput('scenario spec is invalid');
  assertNoAuthorityMaterial(record);
  switch (record.type) {
    case 'text-embed':
      if (!execute) invalidAIInput('text-embed is not an async Job spec');
      assertExactKeys(record, ['type', 'inputs'], 'text embed spec');
      if (!Array.isArray(record.inputs) || record.inputs.length === 0 || record.inputs.length > 16) {
        invalidAIInput('text embed inputs are invalid');
      }
      record.inputs.forEach((value, index) => boundedContent(value, `text embed input ${index}`, 32 * 1024));
      break;
    case 'image-generate':
      assertExactKeys(record, ['type', 'prompt', 'negativePrompt', 'n', 'size', 'aspectRatio', 'quality', 'style', 'seed', 'referenceImages', 'referenceImageArtifactId', 'mask', 'responseFormat'], 'image spec');
      boundedContent(record.prompt, 'image prompt', 32 * 1024);
      optionalBoundedText(record.negativePrompt, 'image negativePrompt', 32 * 1024);
      optionalBoundedInteger(record.n, 'image n', 0, 4);
      boundedToken(record.size, 'image size', 128);
      boundedToken(record.aspectRatio, 'image aspectRatio', 128);
      boundedToken(record.quality, 'image quality', 128);
      boundedToken(record.style, 'image style', 128);
      optionalBoundedInteger(record.seed, 'image seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      if (!Array.isArray(record.referenceImages) || record.referenceImages.length > 1) invalidAIInput('image referenceImages are invalid');
      record.referenceImages.forEach((value, index) => boundedHttpsUrl(value, `image reference ${index}`));
      if (typeof record.referenceImageArtifactId !== 'string') invalidAIInput('image referenceImageArtifactId is invalid');
      if (record.referenceImageArtifactId !== '') boundedIdentifier(record.referenceImageArtifactId, 'image referenceImageArtifactId');
      if (record.referenceImages.length > 0 && record.referenceImageArtifactId !== '') {
        invalidAIInput('image referenceImages and referenceImageArtifactId are mutually exclusive');
      }
      if (record.mask !== '') boundedHttpsUrl(record.mask, 'image mask');
      if (!['', 'b64_json', 'url'].includes(String(record.responseFormat))) invalidAIInput('image responseFormat is invalid');
      break;
    case 'video-generate':
      if (execute) invalidAIInput('video-generate is not a synchronous spec');
      validateVideoSpec(record);
      break;
    case 'speech-synthesize':
      if (execute) invalidAIInput('speech-synthesize is not a synchronous spec');
      validateSpeechSynthesizeSpec(record);
      break;
    case 'speech-transcribe':
      if (execute) invalidAIInput('speech-transcribe is not a synchronous spec');
      validateSpeechTranscribeSpec(record);
      break;
    case 'voice-create':
      if (execute) invalidAIInput('voice-create is not a synchronous spec');
      validateVoiceCreateSpec(record);
      break;
    case 'music-generate':
      if (execute) invalidAIInput('music-generate is not a synchronous spec');
      assertExactKeys(record, ['type', 'prompt', 'lyrics'], 'music spec');
      boundedContent(record.prompt, 'music prompt', 32 * 1024);
      boundedContent(record.lyrics, 'music lyrics', 32 * 1024);
      break;
    default:
      invalidAIInput('scenario type is invalid');
  }
  return spec;
}

function validateScenarioJobSubmitOptions(
  options: NimiLocalAppScenarioJobSubmitOptions,
): NimiLocalAppScenarioJobSubmitOptions {
  assertExactKeys(options, ['timeoutMs'], 'Scenario Job submit options');
  return Object.freeze({
    timeoutMs: boundedInteger(options.timeoutMs ?? 0, 'Scenario Job timeoutMs', 0, 2_147_483_647),
  });
}

function validateVideoSpec(record: Record<string, unknown>): void {
  assertExactKeys(record, ['type', 'prompt', 'negativePrompt', 'mode', 'content', 'options'], 'video spec');
  optionalBoundedText(record.prompt, 'video prompt', 32 * 1024);
  optionalBoundedText(record.negativePrompt, 'video negativePrompt', 32 * 1024);
  if (!['t2v', 'i2v-first-frame', 'i2v-first-last', 'i2v-reference'].includes(String(record.mode))
    || !Array.isArray(record.content) || record.content.length > 8) invalidAIInput('video spec is invalid');
  record.content.forEach((entry, index) => {
    const content = asRecord(entry);
    if (!content || !['prompt', 'first-frame', 'last-frame', 'reference-image', 'reference-video', 'reference-audio'].includes(String(content.role))) {
      invalidAIInput(`video content ${index} is invalid`);
    }
    if (content.type === 'text') {
      assertExactKeys(content, ['type', 'role', 'text'], `video content ${index}`);
      boundedContent(content.text, `video content ${index} text`, 8 * 1024);
    } else if (['image-url', 'video-url', 'audio-url'].includes(String(content.type))) {
      assertExactKeys(content, ['type', 'role', 'url'], `video content ${index}`);
      boundedHttpsUrl(content.url, `video content ${index} url`);
    } else if (content.type === 'artifact-ref') {
      assertExactKeys(content, ['type', 'role', 'artifactId'], `video content ${index}`);
      boundedIdentifier(content.artifactId, `video content ${index} artifactId`);
    } else invalidAIInput(`video content ${index} type is invalid`);
  });
  if (!String(record.prompt).trim() && record.content.length === 0) invalidAIInput('video prompt or content is required');
  const options = asRecord(record.options);
  assertExactKeys(options, ['resolution', 'ratio', 'durationSec', 'frames', 'fps', 'seed', 'cameraFixed', 'watermark', 'generateAudio', 'draft', 'returnLastFrame'], 'video options');
  boundedToken(options.resolution, 'video resolution', 64);
  boundedToken(options.ratio, 'video ratio', 64);
  optionalBoundedInteger(options.durationSec, 'video durationSec', 0, 600);
  optionalBoundedInteger(options.frames, 'video frames', 0, 100_000);
  optionalBoundedInteger(options.fps, 'video fps', 0, 120);
  optionalBoundedInteger(options.seed, 'video seed', -1, 4_294_967_295);
  for (const field of ['cameraFixed', 'watermark', 'generateAudio', 'draft', 'returnLastFrame']) {
    if (options[field] !== undefined && typeof options[field] !== 'boolean') invalidAIInput(`video ${field} is invalid`);
  }
}

function validateSpeechSynthesizeSpec(record: Record<string, unknown>): void {
  assertExactKeys(record, ['type', 'text', 'language', 'audioFormat', 'sampleRateHz', 'speed', 'pitch', 'volume', 'emotion', 'voiceRef', 'timingMode', 'voiceRenderHints'], 'speech synthesize spec');
  boundedContent(record.text, 'speech text', 32 * 1024);
  boundedToken(record.language, 'speech language', 64);
  boundedToken(record.audioFormat, 'speech audioFormat', 64);
  optionalBoundedInteger(record.sampleRateHz, 'speech sampleRateHz', 0, 192_000);
  optionalBoundedNumber(record.speed, 'speech speed', 0, 4);
  optionalBoundedNumber(record.pitch, 'speech pitch', -24, 24);
  optionalBoundedNumber(record.volume, 'speech volume', 0, 4);
  boundedToken(record.emotion, 'speech emotion', 128);
  if (!['none', 'word', 'char'].includes(String(record.timingMode))) invalidAIInput('speech timingMode is invalid');
  if (record.voiceRef !== null) {
    const voiceRef = asRecord(record.voiceRef);
    assertExactKeys(voiceRef, ['type', 'id'], 'speech voiceRef');
    if (!voiceRef || !['preset', 'voice-asset'].includes(String(voiceRef.type))) invalidAIInput('speech voiceRef is invalid');
    boundedIdentifier(voiceRef.id, 'speech voiceRef id');
  }
  if (record.voiceRenderHints !== null) {
    const hints = asRecord(record.voiceRenderHints);
    assertExactKeys(hints, ['stability', 'similarityBoost', 'style', 'useSpeakerBoost', 'speed'], 'speech voiceRenderHints');
    for (const field of ['stability', 'similarityBoost', 'style', 'speed']) boundedNumber(hints[field], `speech ${field}`, 0, 10);
    if (typeof hints.useSpeakerBoost !== 'boolean') invalidAIInput('speech useSpeakerBoost is invalid');
  }
}

function validateSpeechTranscribeSpec(record: Record<string, unknown>): void {
  assertExactKeys(record, ['type', 'mimeType', 'language', 'timestamps', 'diarization', 'speakerCount', 'prompt', 'responseFormat', 'audioSource'], 'speech transcribe spec');
  boundedToken(record.mimeType, 'transcription mimeType', 128);
  boundedToken(record.language, 'transcription language', 64);
  optionalBoundedInteger(record.speakerCount, 'transcription speakerCount', 0, 32);
  optionalBoundedText(record.prompt, 'transcription prompt', 4 * 1024);
  boundedToken(record.responseFormat, 'transcription responseFormat', 64);
  if ((record.timestamps !== undefined && typeof record.timestamps !== 'boolean')
    || (record.diarization !== undefined && typeof record.diarization !== 'boolean')) invalidAIInput('transcription flags are invalid');
  validateAudioSource(record.audioSource, MAX_ARTIFACT_BYTES, 'transcription audioSource');
}

function validateVoiceCreateSpec(record: Record<string, unknown>): void {
  if (record.creationSource === 'reference-audio') {
    assertExactKeys(record, ['type', 'creationSource', 'referenceAudio', 'referenceAudioMime', 'languageHints', 'preferredName', 'text'], 'voice create reference-audio spec');
    const referenceAudio = asRecord(record.referenceAudio);
    validateAudioSource(record.referenceAudio, 20 * 1024 * 1024, 'voice referenceAudio');
    const referenceAudioMime = boundedToken(record.referenceAudioMime, 'voice referenceAudioMime', 128);
    if (referenceAudio?.type === 'bytes' && !referenceAudioMime) invalidAIInput('voice referenceAudioMime is required for bytes');
    if (!Array.isArray(record.languageHints) || record.languageHints.length > 8) invalidAIInput('voice languageHints are invalid');
    record.languageHints.forEach((hint, index) => {
      if (!boundedToken(hint, `voice languageHint ${index}`, 64)) invalidAIInput(`voice languageHint ${index} is empty`);
    });
    boundedToken(record.preferredName, 'voice preferredName', 256);
    optionalBoundedText(record.text, 'voice text', 32 * 1024);
    return;
  }
  if (record.creationSource === 'text-description') {
    assertExactKeys(record, ['type', 'creationSource', 'instructionText', 'previewText', 'language', 'preferredName'], 'voice create text-description spec');
    boundedContent(record.instructionText, 'voice instructionText', 8 * 1024);
    optionalBoundedText(record.previewText, 'voice previewText', 8 * 1024);
    boundedToken(record.language, 'voice language', 64);
    boundedToken(record.preferredName, 'voice preferredName', 256);
    return;
  }
  invalidAIInput('voice creationSource is invalid');
}

function validateAudioSource(value: unknown, maxBytes: number, field: string): void {
  const source = asRecord(value);
  if (!source) invalidAIInput(`${field} is invalid`);
  if (source.type === 'bytes') {
    assertExactKeys(source, ['type', 'bytes'], field);
    validateByteArray(source.bytes, field, maxBytes, false);
  } else if (source.type === 'uri') {
    assertExactKeys(source, ['type', 'uri'], field);
    boundedHttpsUrl(source.uri, `${field} uri`);
  } else invalidAIInput(`${field} type is invalid`);
}

function projectSubscription<T>(
  subscription: NimiLocalAppShellStream<unknown>,
  projector: (value: unknown) => T,
): NimiLocalAppSubscription<T> {
  const record = asRecord(subscription);
  assertExactProjectionKeys(record, ['events', 'cancel'], 'AI subscription');
  if (!isAsyncIterable(record.events) || typeof record.cancel !== 'function') {
    localAppProjectionError('AI subscription');
  }
  const projected: NimiLocalAppSubscription<T> = {
    async *[Symbol.asyncIterator]() {
      for await (const event of record.events as AsyncIterable<unknown>) yield projector(event);
    },
    cancel: async () => { await (record.cancel as () => Promise<void>)(); },
  };
  return Object.freeze(projected);
}

function projectTextTurnEvent(value: unknown): NimiLocalAppTextTurnEvent {
  const record = asRecord(value);
  if (!record || !/^[1-9][0-9]*$/u.test(String(record.sequence))) localAppProjectionError('text-turn event');
  const base = { sequence: String(record.sequence), traceId: boundedProjectionText(record.traceId, 'text-turn traceId', 512) };
  if (record.type === 'delta') {
    assertExactProjectionKeys(record, ['type', 'sequence', 'traceId', 'text'], 'text-turn delta');
    return Object.freeze({ ...base, type: 'delta', text: boundedProjectionContent(record.text, 'text-turn text', 64 * 1024) });
  }
  if (record.type === 'completed') {
    assertExactProjectionKeys(record, ['type', 'sequence', 'traceId', 'finishReason'], 'text-turn completed');
    if (!['stop', 'length', 'content-filter'].includes(String(record.finishReason))) localAppProjectionError('text-turn finishReason');
    return Object.freeze({ ...base, type: 'completed', finishReason: record.finishReason }) as NimiLocalAppTextTurnEvent;
  }
  if (record.type === 'failed') {
    assertExactProjectionKeys(record, ['type', 'sequence', 'traceId', 'reasonCode', 'actionHint'], 'text-turn failed');
    return Object.freeze({ ...base, type: 'failed', reasonCode: boundedProjectionText(record.reasonCode, 'text-turn reasonCode', 128), actionHint: optionalProjectionText(record.actionHint, 'text-turn actionHint', 512) });
  }
  return localAppProjectionError('text-turn event type');
}

function projectScenarioExecute(value: unknown): NimiLocalAppScenarioExecuteResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['output', 'traceId'], 'scenario execute');
  assertSafeProjection(record);
  const output = asRecord(record.output);
  if (!output) localAppProjectionError('scenario execute output');
  const traceId = boundedProjectionText(record.traceId, 'scenario execute traceId', 512);
  if (output.type === 'text-embed') {
    assertExactProjectionKeys(output, ['type', 'vectors'], 'text embed output');
    if (!Array.isArray(output.vectors) || output.vectors.length === 0 || output.vectors.length > 16) localAppProjectionError('text embed vectors');
    const vectors = output.vectors.map((vector) => {
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > 8192
        || vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) localAppProjectionError('text embed vector');
      return Object.freeze([...vector] as number[]);
    });
    return Object.freeze({ output: Object.freeze({ type: 'text-embed', vectors: Object.freeze(vectors) }), traceId });
  }
  if (output.type === 'image-generate') {
    assertExactProjectionKeys(output, ['type', 'artifacts'], 'image execute output');
    return Object.freeze({ output: Object.freeze({ type: 'image-generate', artifacts: projectArtifacts(output.artifacts) }), traceId });
  }
  return localAppProjectionError('scenario execute output type');
}

function projectScenarioJobSubmit(value: unknown): NimiLocalAppScenarioJobSubmitResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['job'], 'scenario Job submit');
  return Object.freeze({ job: projectScenarioJob(record.job) });
}

function projectScenarioJobGet(value: unknown): NimiLocalAppScenarioJobGetResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['job', 'asset', 'voiceReference'], 'scenario Job result');
  const job = projectScenarioJob(record.job);
  const asset = record.asset === null ? null : projectVoiceAsset(record.asset);
  const voiceReference = record.voiceReference === null ? null : projectVoiceAssetReference(record.voiceReference);
  if ((asset === null) !== (voiceReference === null)
    || (asset && (asset.status !== 'active' || voiceReference?.voiceAssetId !== asset.voiceAssetId))
    || ((job.scenarioType === 'voice-create' && job.status === 'completed') !== (asset !== null))) {
    localAppProjectionError('scenario Job voice result');
  }
  return Object.freeze({
    job,
    asset,
    voiceReference,
  });
}

function projectScenarioJobEnvelope(value: unknown): { readonly job: NimiLocalAppScenarioJob } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['job'], 'scenario Job envelope');
  return Object.freeze({ job: projectScenarioJob(record.job) });
}

function projectScenarioJob(value: unknown): NimiLocalAppScenarioJob {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['jobId', 'scenarioType', 'status', 'progressPercent', 'progressCurrentStep', 'progressTotalSteps', 'reasonCode', 'reasonDetail', 'artifacts', 'traceId', 'createdAt', 'updatedAt', 'transcriptionText'], 'scenario Job');
  assertSafeProjection(record);
  if (!LOCAL_SCENARIO_TYPES.includes(record.scenarioType as never) || !LOCAL_JOB_STATUSES.includes(record.status as never)) localAppProjectionError('scenario Job enum');
  const current = projectionInteger(record.progressCurrentStep, 'scenario Job current step', 0, Number.MAX_SAFE_INTEGER);
  const total = projectionInteger(record.progressTotalSteps, 'scenario Job total steps', 0, Number.MAX_SAFE_INTEGER);
  if (current > total) localAppProjectionError('scenario Job progress');
  return Object.freeze({
    jobId: boundedProjectionText(record.jobId, 'scenario Job id', MAX_IDENTIFIER_BYTES),
    scenarioType: record.scenarioType,
    status: record.status,
    progressPercent: projectionInteger(record.progressPercent, 'scenario Job percent', 0, 100),
    progressCurrentStep: current,
    progressTotalSteps: total,
    reasonCode: optionalProjectionText(record.reasonCode, 'scenario Job reasonCode', 128),
    reasonDetail: optionalProjectionText(record.reasonDetail, 'scenario Job reasonDetail', 1024),
    artifacts: projectArtifacts(record.artifacts),
    traceId: optionalProjectionText(record.traceId, 'scenario Job traceId', 512),
    createdAt: projectTimestamp(record.createdAt, 'scenario Job createdAt'),
    updatedAt: projectTimestamp(record.updatedAt, 'scenario Job updatedAt'),
    transcriptionText: optionalProjectionText(record.transcriptionText, 'scenario Job transcriptionText', MAX_RESULT_BYTES),
  }) as NimiLocalAppScenarioJob;
}

function projectArtifacts(value: unknown): readonly NimiLocalAppScenarioArtifact[] {
  if (!Array.isArray(value) || value.length > 16) localAppProjectionError('scenario artifacts');
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertExactProjectionKeys(record, ['artifactId', 'mimeType', 'bytes', 'sizeBytes', 'sha256', 'durationMs', 'width', 'height', 'sampleRateHz', 'channels'], 'scenario artifact');
    const bytes = validateProjectionBytes(record.bytes, 'scenario artifact bytes');
    const sizeBytes = projectionInteger(record.sizeBytes, 'scenario artifact sizeBytes', 0, Number.MAX_SAFE_INTEGER);
    if (bytes.length > 0 && bytes.length !== sizeBytes) localAppProjectionError('scenario artifact byte size');
    return Object.freeze({
      artifactId: boundedProjectionText(record.artifactId, 'scenario artifact id', MAX_IDENTIFIER_BYTES),
      mimeType: mimeProjection(record.mimeType),
      bytes,
      sizeBytes,
      sha256: optionalProjectionText(record.sha256, 'scenario artifact sha256', 128),
      durationMs: projectionInteger(record.durationMs, 'scenario artifact durationMs', 0, Number.MAX_SAFE_INTEGER),
      width: projectionInteger(record.width, 'scenario artifact width', 0, Number.MAX_SAFE_INTEGER),
      height: projectionInteger(record.height, 'scenario artifact height', 0, Number.MAX_SAFE_INTEGER),
      sampleRateHz: projectionInteger(record.sampleRateHz, 'scenario artifact sampleRateHz', 0, Number.MAX_SAFE_INTEGER),
      channels: projectionInteger(record.channels, 'scenario artifact channels', 0, Number.MAX_SAFE_INTEGER),
    });
  }));
}

function projectArtifactUpload(
  value: unknown,
  expectedSize: number,
  expectedMimeType: NimiLocalAppArtifactImageMime,
): NimiLocalAppArtifactUploadResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['artifactId', 'sizeBytes', 'mimeType'], 'artifact upload result');
  assertNoAuthorityMaterial(record);
  const artifactId = projectionText(record.artifactId, 'artifact upload artifactId');
  if (utf8Length(artifactId) > MAX_IDENTIFIER_BYTES
    || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes !== expectedSize
    || record.sizeBytes < 1 || record.sizeBytes > MAX_ARTIFACT_BYTES
    || record.mimeType !== expectedMimeType || !isArtifactImageMime(record.mimeType)) {
    localAppProjectionError('artifact upload result');
  }
  return Object.freeze({ artifactId, sizeBytes: record.sizeBytes as number, mimeType: record.mimeType });
}

function isArtifactImageMime(value: unknown): value is NimiLocalAppArtifactImageMime {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif';
}

function projectArtifactRead(value: unknown): { readonly bytes: Uint8Array; readonly mimeType: string; readonly sizeBytes: number } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['bytes', 'mimeType', 'sizeBytes'], 'artifact read');
  const bytes = validateProjectionBytes(record.bytes, 'artifact read bytes');
  const sizeBytes = projectionInteger(record.sizeBytes, 'artifact read sizeBytes', 0, MAX_ARTIFACT_BYTES);
  if (bytes.length !== sizeBytes) localAppProjectionError('artifact read byte size');
  return Object.freeze({ bytes: Uint8Array.from(bytes), mimeType: mimeProjection(record.mimeType), sizeBytes });
}

function projectScenarioJobEvent(value: unknown): NimiLocalAppScenarioJobEvent {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['eventType', 'sequence', 'traceId', 'timestamp', 'job'], 'scenario Job event');
  if (!LOCAL_JOB_STATUSES.includes(record.eventType as never) || !/^[1-9][0-9]*$/u.test(String(record.sequence))) localAppProjectionError('scenario Job event');
  return Object.freeze({
    eventType: record.eventType,
    sequence: String(record.sequence),
    traceId: optionalProjectionText(record.traceId, 'scenario Job event traceId', 512),
    timestamp: projectTimestamp(record.timestamp, 'scenario Job event timestamp'),
    job: projectScenarioJob(record.job),
  }) as NimiLocalAppScenarioJobEvent;
}

function projectVoiceAsset(value: unknown): NimiLocalAppVoiceAsset {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['voiceAssetId', 'creationSource', 'status', 'createdAt', 'updatedAt', 'expiresAt'], 'voice asset');
  if (!['reference-audio', 'text-description'].includes(String(record.creationSource))
    || !['active', 'expired', 'deleted', 'failed'].includes(String(record.status))) localAppProjectionError('voice asset enum');
  return Object.freeze({
    voiceAssetId: boundedProjectionText(record.voiceAssetId, 'voice asset id', MAX_IDENTIFIER_BYTES),
    creationSource: record.creationSource,
    status: record.status,
    createdAt: projectTimestamp(record.createdAt, 'voice asset createdAt'),
    updatedAt: projectTimestamp(record.updatedAt, 'voice asset updatedAt'),
    expiresAt: projectTimestamp(record.expiresAt, 'voice asset expiresAt'),
  }) as NimiLocalAppVoiceAsset;
}

function projectVoiceAssetReference(value: unknown): { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['kind', 'voiceAssetId'], 'voice asset reference');
  if (record.kind !== 'voice_asset_id') localAppProjectionError('voice asset reference kind');
  return Object.freeze({
    kind: 'voice_asset_id',
    voiceAssetId: boundedProjectionText(record.voiceAssetId, 'voice asset reference id', MAX_IDENTIFIER_BYTES),
  });
}

function projectVoiceAssetsList(value: unknown): { readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['assets', 'nextPageToken'], 'voice asset list');
  if (!Array.isArray(record.assets) || record.assets.length > 200
    || typeof record.nextPageToken !== 'string' || !/^[0-9]{0,10}$/u.test(record.nextPageToken)) localAppProjectionError('voice asset list');
  return Object.freeze({ assets: Object.freeze(record.assets.map(projectVoiceAsset)), nextPageToken: record.nextPageToken });
}

function projectRuntimeLocalAppVoiceAsset(asset: LocalAppVoiceAsset): NimiLocalAppVoiceAsset {
  return {
    voiceAssetId: asset.voiceAssetId,
    creationSource: localVoiceCreationSource(asset.creationSource),
    status: localVoiceAssetStatus(asset.status),
    createdAt: plainRuntimeTimestamp(asset.createdAt),
    updatedAt: plainRuntimeTimestamp(asset.updatedAt),
    expiresAt: plainRuntimeTimestamp(asset.expiresAt),
  };
}

function runtimeTextTurnRequest(input: NimiLocalAppTextCandidateInput): StreamLocalAppTextTurnRequest {
  return {
    messages: input.messages.map((message) => ({ role: message.role, text: message.text })),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.topP === undefined ? {} : { topP: input.topP }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(input.topK === undefined ? {} : { topK: input.topK }),
    ...(input.presencePenalty === undefined ? {} : { presencePenalty: input.presencePenalty }),
    ...(input.frequencyPenalty === undefined ? {} : { frequencyPenalty: input.frequencyPenalty }),
    stop: input.stop === undefined ? [] : [...input.stop],
    ...(input.seed === undefined ? {} : { seed: String(input.seed) }),
  };
}

function runtimeExecuteRequest(spec: NimiLocalAppScenarioExecuteSpec): ExecuteLocalAppScenarioRequest {
  if (spec.type === 'text-embed') {
    return { spec: { oneofKind: 'textEmbed', textEmbed: { inputs: [...spec.inputs] } } };
  }
  return { spec: { oneofKind: 'imageGenerate', imageGenerate: runtimeImageSpec(spec) } };
}

function runtimeLocalJobSpec(
  spec: NimiLocalAppScenarioJobSpec,
): SubmitLocalAppScenarioJobRequest['spec'] {
  switch (spec.type) {
    case 'image-generate':
      return { oneofKind: 'imageGenerate', imageGenerate: runtimeImageSpec(spec) };
    case 'video-generate':
      return {
        oneofKind: 'videoGenerate',
        videoGenerate: {
          prompt: spec.prompt,
          negativePrompt: spec.negativePrompt,
          mode: runtimeVideoMode(spec.mode),
          content: spec.content.map((entry) => ({
            type: runtimeVideoContentType(entry.type),
            role: runtimeVideoRole(entry.role),
            text: entry.type === 'text' ? entry.text : '',
            ...(entry.type === 'image-url' ? { imageUrl: { url: entry.url } } : {}),
            ...(entry.type === 'video-url' ? { videoUrl: { url: entry.url } } : {}),
            ...(entry.type === 'audio-url' ? { audioUrl: { url: entry.url } } : {}),
            ...(entry.type === 'artifact-ref' ? { artifactRef: { artifactId: entry.artifactId } } : {}),
          })),
          options: {
            resolution: spec.options.resolution,
            ratio: spec.options.ratio,
            ...(spec.options.durationSec === undefined ? {} : { durationSec: spec.options.durationSec }),
            ...(spec.options.frames === undefined ? {} : { frames: spec.options.frames }),
            ...(spec.options.fps === undefined ? {} : { fps: spec.options.fps }),
            ...(spec.options.seed === undefined ? {} : { seed: String(spec.options.seed) }),
            ...(spec.options.cameraFixed === undefined ? {} : { cameraFixed: spec.options.cameraFixed }),
            ...(spec.options.watermark === undefined ? {} : { watermark: spec.options.watermark }),
            ...(spec.options.generateAudio === undefined ? {} : { generateAudio: spec.options.generateAudio }),
            ...(spec.options.draft === undefined ? {} : { draft: spec.options.draft }),
            ...(spec.options.returnLastFrame === undefined ? {} : { returnLastFrame: spec.options.returnLastFrame }),
          },
        },
      };
    case 'speech-synthesize':
      return {
        oneofKind: 'speechSynthesize',
        speechSynthesize: {
          text: spec.text,
          language: spec.language,
          audioFormat: spec.audioFormat,
          ...(spec.sampleRateHz === undefined ? {} : { sampleRateHz: spec.sampleRateHz }),
          ...(spec.speed === undefined ? {} : { speed: spec.speed }),
          ...(spec.pitch === undefined ? {} : { pitch: spec.pitch }),
          ...(spec.volume === undefined ? {} : { volume: spec.volume }),
          emotion: spec.emotion,
          ...(spec.voiceRef === null ? {} : { voiceRef: runtimeVoiceReference(spec.voiceRef) }),
          timingMode: runtimeSpeechTimingMode(spec.timingMode),
          ...(spec.voiceRenderHints === null ? {} : { voiceRenderHints: { ...spec.voiceRenderHints } }),
        },
      };
    case 'speech-transcribe':
      return {
        oneofKind: 'speechTranscribe',
        speechTranscribe: {
          mimeType: spec.mimeType,
          language: spec.language,
          ...(spec.timestamps === undefined ? {} : { timestamps: spec.timestamps }),
          ...(spec.diarization === undefined ? {} : { diarization: spec.diarization }),
          ...(spec.speakerCount === undefined ? {} : { speakerCount: spec.speakerCount }),
          prompt: spec.prompt,
          responseFormat: spec.responseFormat,
          audioSource: {
            source: spec.audioSource.type === 'bytes'
              ? { oneofKind: 'audioBytes', audioBytes: Uint8Array.from(spec.audioSource.bytes) }
              : { oneofKind: 'audioUri', audioUri: spec.audioSource.uri },
          },
        },
      };
    case 'voice-create':
      if (spec.creationSource === 'reference-audio') {
        return {
          oneofKind: 'voiceCreate',
          voiceCreate: {
            source: {
              oneofKind: 'referenceAudio',
              referenceAudio: {
                referenceAudioBytes: spec.referenceAudio.type === 'bytes'
                  ? Uint8Array.from(spec.referenceAudio.bytes)
                  : new Uint8Array(),
                referenceAudioUri: spec.referenceAudio.type === 'uri' ? spec.referenceAudio.uri : '',
                referenceAudioMime: spec.referenceAudioMime,
                languageHints: [...spec.languageHints],
                preferredName: spec.preferredName,
                text: spec.text,
              },
            },
          },
        };
      }
      return {
        oneofKind: 'voiceCreate',
        voiceCreate: {
          source: {
            oneofKind: 'textDescription',
            textDescription: {
              instructionText: spec.instructionText,
              previewText: spec.previewText,
              language: spec.language,
              preferredName: spec.preferredName,
            },
          },
        },
      };
    case 'music-generate':
      return {
        oneofKind: 'musicGenerate',
        musicGenerate: { prompt: spec.prompt, lyrics: spec.lyrics },
      };
  }
}

function runtimeImageSpec(spec: NimiLocalAppImageGenerateSpec) {
  return {
    prompt: spec.prompt,
    negativePrompt: spec.negativePrompt,
    ...(spec.n === undefined ? {} : { n: spec.n }),
    size: spec.size,
    aspectRatio: spec.aspectRatio,
    quality: spec.quality,
    style: spec.style,
    ...(spec.seed === undefined ? {} : { seed: String(spec.seed) }),
    referenceImages: [...spec.referenceImages],
    mask: spec.mask,
    responseFormat: spec.responseFormat,
    referenceImageArtifactId: spec.referenceImageArtifactId,
  };
}

function runtimeVideoMode(value: Extract<NimiLocalAppScenarioJobSpec, { type: 'video-generate' }>['mode']): VideoMode {
  return ({
    't2v': VideoMode.T2V,
    'i2v-first-frame': VideoMode.I2V_FIRST_FRAME,
    'i2v-first-last': VideoMode.I2V_FIRST_LAST,
    'i2v-reference': VideoMode.I2V_REFERENCE,
  })[value];
}

function runtimeVideoRole(value: NimiLocalAppVideoContentRole): VideoContentRole {
  return ({
    'prompt': VideoContentRole.PROMPT,
    'first-frame': VideoContentRole.FIRST_FRAME,
    'last-frame': VideoContentRole.LAST_FRAME,
    'reference-image': VideoContentRole.REFERENCE_IMAGE,
    'reference-video': VideoContentRole.REFERENCE_VIDEO,
    'reference-audio': VideoContentRole.REFERENCE_AUDIO,
  })[value];
}

function runtimeVideoContentType(value: NimiLocalAppVideoContent['type']): VideoContentType {
  return ({
    'text': VideoContentType.TEXT,
    'image-url': VideoContentType.IMAGE_URL,
    'video-url': VideoContentType.VIDEO_URL,
    'audio-url': VideoContentType.AUDIO_URL,
    'artifact-ref': VideoContentType.ARTIFACT_REF,
  })[value];
}

function runtimeSpeechTimingMode(value: 'none' | 'word' | 'char'): SpeechTimingMode {
  return ({ none: SpeechTimingMode.NONE, word: SpeechTimingMode.WORD, char: SpeechTimingMode.CHAR })[value];
}

function runtimeVoiceReference(
  value: { readonly type: 'preset' | 'voice-asset'; readonly id: string },
): VoiceReference {
  return value.type === 'preset'
    ? {
        kind: VoiceReferenceKind.PRESET,
        reference: { oneofKind: 'presetVoiceId', presetVoiceId: value.id },
      }
    : {
        kind: VoiceReferenceKind.VOICE_ASSET,
        reference: { oneofKind: 'voiceAssetId', voiceAssetId: value.id },
      };
}

function projectRuntimeTextTurnEvent(event: StreamLocalAppTextTurnEvent): unknown {
  const base = { sequence: event.sequence, traceId: event.traceId };
  switch (event.payload.oneofKind) {
    case 'delta':
      return { ...base, type: 'delta', text: event.payload.delta.text };
    case 'completed':
      return {
        ...base,
        type: 'completed',
        finishReason: runtimeFinishReason(event.payload.completed.finishReason),
      };
    case 'failed':
      return {
        ...base,
        type: 'failed',
        reasonCode: runtimeReasonToken(event.payload.failed.reasonCode),
        actionHint: event.payload.failed.actionHint,
      };
    default:
      return localAppProjectionError('text-turn Runtime event');
  }
}

function projectRuntimeScenarioExecuteResponse(response: ExecuteLocalAppScenarioResponse): unknown {
  switch (response.output.oneofKind) {
    case 'textEmbed':
      return {
        output: {
          type: 'text-embed',
          vectors: response.output.textEmbed.vectors.map((vector) => [...vector.values]),
        },
        traceId: response.traceId,
      };
    case 'imageGenerate':
      return {
        output: {
          type: 'image-generate',
          artifacts: response.output.imageGenerate.artifacts.map(projectRuntimeLocalArtifact),
        },
        traceId: response.traceId,
      };
    default:
      return localAppProjectionError('scenario Runtime output');
  }
}

function projectRuntimeLocalJob(job: LocalAppScenarioJob): unknown {
  return {
    jobId: job.jobId,
    scenarioType: runtimeScenarioTypeName(job.scenarioType),
    status: runtimeJobStatusName(job.status),
    progressPercent: job.progressPercent,
    progressCurrentStep: job.progressCurrentStep,
    progressTotalSteps: job.progressTotalSteps,
    reasonCode: runtimeReasonToken(job.reasonCode),
    reasonDetail: job.reasonDetail,
    artifacts: job.artifacts.map(projectRuntimeLocalArtifact),
    traceId: job.traceId,
    createdAt: plainRuntimeTimestamp(job.createdAt),
    updatedAt: plainRuntimeTimestamp(job.updatedAt),
    transcriptionText: job.transcriptionText,
  };
}

function projectRuntimeLocalArtifact(
  artifact: LocalAppScenarioJob['artifacts'][number],
): unknown {
  return {
    artifactId: artifact.artifactId,
    mimeType: artifact.mimeType,
    bytes: Array.from(artifact.bytes),
    sizeBytes: runtimeSafeInteger(artifact.sizeBytes, 'scenario artifact size'),
    sha256: artifact.sha256,
    durationMs: runtimeSafeInteger(artifact.durationMs, 'scenario artifact duration'),
    width: artifact.width,
    height: artifact.height,
    sampleRateHz: artifact.sampleRateHz,
    channels: artifact.channels,
  };
}

function projectRuntimeLocalJobEvent(event: LocalAppScenarioJobEvent): unknown {
  return {
    eventType: runtimeJobEventTypeName(event.eventType),
    sequence: event.sequence,
    traceId: event.traceId,
    timestamp: plainRuntimeTimestamp(event.timestamp),
    job: projectRuntimeLocalJob(requiredRuntimeValue(event.job, 'scenario Job event')),
  };
}

function projectRuntimeVoiceReference(reference: VoiceReference): unknown {
  if (reference.kind !== VoiceReferenceKind.VOICE_ASSET
    || reference.reference.oneofKind !== 'voiceAssetId') {
    return localAppProjectionError('voice asset Runtime reference');
  }
  return { kind: 'voice_asset_id', voiceAssetId: reference.reference.voiceAssetId };
}

function runtimeScenarioTypeName(value: ScenarioType): NimiLocalAppScenarioJob['scenarioType'] {
  const types: Partial<Record<ScenarioType, NimiLocalAppScenarioJob['scenarioType']>> = {
    [ScenarioType.IMAGE_GENERATE]: 'image-generate',
    [ScenarioType.VIDEO_GENERATE]: 'video-generate',
    [ScenarioType.SPEECH_SYNTHESIZE]: 'speech-synthesize',
    [ScenarioType.SPEECH_TRANSCRIBE]: 'speech-transcribe',
    [ScenarioType.VOICE_CREATE]: 'voice-create',
    [ScenarioType.MUSIC_GENERATE]: 'music-generate',
  };
  return types[value] ?? localAppProjectionError('scenario Runtime type');
}

function runtimeJobStatusName(value: ScenarioJobStatus): NimiLocalAppScenarioJob['status'] {
  const statuses: Partial<Record<ScenarioJobStatus, NimiLocalAppScenarioJob['status']>> = {
    [ScenarioJobStatus.SUBMITTED]: 'submitted',
    [ScenarioJobStatus.QUEUED]: 'queued',
    [ScenarioJobStatus.RUNNING]: 'running',
    [ScenarioJobStatus.COMPLETED]: 'completed',
    [ScenarioJobStatus.FAILED]: 'failed',
    [ScenarioJobStatus.CANCELED]: 'canceled',
    [ScenarioJobStatus.TIMEOUT]: 'timeout',
  };
  return statuses[value] ?? localAppProjectionError('scenario Runtime status');
}

function runtimeJobEventTypeName(value: ScenarioJobEventType): NimiLocalAppScenarioJobEvent['eventType'] {
  const types: Partial<Record<ScenarioJobEventType, NimiLocalAppScenarioJobEvent['eventType']>> = {
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED]: 'submitted',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED]: 'queued',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING]: 'running',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED]: 'completed',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED]: 'failed',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED]: 'canceled',
    [ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT]: 'timeout',
  };
  return types[value] ?? localAppProjectionError('scenario Runtime event type');
}

function runtimeFinishReason(value: FinishReason): 'stop' | 'length' | 'content-filter' {
  if (value === FinishReason.STOP) return 'stop';
  if (value === FinishReason.LENGTH) return 'length';
  if (value === FinishReason.CONTENT_FILTER) return 'content-filter';
  return localAppProjectionError('text-turn Runtime finish reason');
}

function runtimeReasonToken(value: RuntimeReasonCode): string {
  if (value === RuntimeReasonCode.REASON_CODE_UNSPECIFIED) return '';
  const name = RuntimeReasonCode[value];
  return typeof name === 'string'
    ? name.toLowerCase().replaceAll('_', '-')
    : localAppProjectionError('Runtime reason code');
}

function runtimeSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)
    ? Number(value)
    : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : localAppProjectionError(label);
}

function requiredRuntimeValue<T>(value: T | undefined, label: string): T {
  return value ?? localAppProjectionError(label);
}

function plainRuntimeTimestamp(
  value: { readonly seconds: string; readonly nanos: number } | undefined,
): NimiLocalAppScenarioTimestamp | null {
  return value ? { seconds: value.seconds, nanos: value.nanos } : null;
}

function localVoiceAssetStatus(status: VoiceAssetStatus): NimiLocalAppVoiceAsset['status'] {
  if (status === VoiceAssetStatus.ACTIVE) return 'active';
  if (status === VoiceAssetStatus.EXPIRED) return 'expired';
  if (status === VoiceAssetStatus.DELETED) return 'deleted';
  if (status === VoiceAssetStatus.FAILED) return 'failed';
  return localAppProjectionError('voice asset status');
}

function localVoiceCreationSource(source: VoiceCreationSource): NimiLocalAppVoiceAsset['creationSource'] {
  if (source === VoiceCreationSource.REFERENCE_AUDIO) return 'reference-audio';
  if (source === VoiceCreationSource.TEXT_DESCRIPTION) return 'text-description';
  return localAppProjectionError('voice asset creationSource');
}

const LOCAL_SCENARIO_TYPES = ['image-generate', 'video-generate', 'speech-synthesize', 'speech-transcribe', 'voice-create', 'music-generate'] as const;
const LOCAL_JOB_STATUSES = ['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'] as const;

function localJobSpecFromRuntimeRequest(request: SubmitScenarioJobRequest): NimiLocalAppScenarioJobSpec {
  assertExactKeys(request, ['head', 'scenarioType', 'executionMode', 'spec', 'requestId', 'idempotencyKey', 'labels', 'extensions'], 'Runtime Scenario Job adapter request');
  if (request.executionMode !== ExecutionMode.ASYNC_JOB || request.extensions.length > 0) adapterInputError('unsupported execution mode or extensions');
  const spec = request.spec?.spec;
  if (!spec || spec.oneofKind === undefined) adapterInputError('missing Scenario spec');
  switch (spec.oneofKind) {
    case 'imageGenerate':
      requireScenarioType(request, ScenarioType.IMAGE_GENERATE);
      return validateScenarioSpec({
        type: 'image-generate', prompt: spec.imageGenerate.prompt,
        negativePrompt: spec.imageGenerate.negativePrompt,
        ...(spec.imageGenerate.n !== undefined ? { n: spec.imageGenerate.n } : {}),
        size: spec.imageGenerate.size, aspectRatio: spec.imageGenerate.aspectRatio,
        quality: spec.imageGenerate.quality, style: spec.imageGenerate.style,
        ...(spec.imageGenerate.seed !== undefined
          ? { seed: safeOptionalSignedInt64(spec.imageGenerate.seed, 'image seed') }
          : {}),
        referenceImages: spec.imageGenerate.referenceImages,
        referenceImageArtifactId: spec.imageGenerate.referenceImageArtifactId,
        mask: spec.imageGenerate.mask,
        responseFormat: spec.imageGenerate.responseFormat as '' | 'b64_json' | 'url',
      }, false);
    case 'videoGenerate':
      requireScenarioType(request, ScenarioType.VIDEO_GENERATE);
      if (!spec.videoGenerate.options || spec.videoGenerate.options.serviceTier || spec.videoGenerate.options.executionExpiresAfterSec) adapterInputError('video private scheduling fields are unavailable to Local Apps');
      return validateScenarioSpec(runtimeVideoSpec(spec.videoGenerate), false);
    case 'speechSynthesize':
      requireScenarioType(request, ScenarioType.SPEECH_SYNTHESIZE);
      return validateScenarioSpec(runtimeSpeechSynthesizeSpec(spec.speechSynthesize), false);
    case 'speechTranscribe':
      requireScenarioType(request, ScenarioType.SPEECH_TRANSCRIBE);
      return validateScenarioSpec(runtimeSpeechTranscribeSpec(spec.speechTranscribe), false);
    case 'voiceCreate': {
      requireScenarioType(request, ScenarioType.VOICE_CREATE);
      if (spec.voiceCreate.targetModelId) adapterInputError('voice target model is Runtime-derived');
      const source = spec.voiceCreate.source;
      if (!source || source.oneofKind === undefined) return adapterInputError('voice create source is missing');
      if (source.oneofKind === 'referenceAudio') {
        return validateScenarioSpec({
          type: 'voice-create', creationSource: 'reference-audio',
          referenceAudio: runtimeVoiceAudio(source.referenceAudio.referenceAudioBytes, source.referenceAudio.referenceAudioUri),
          referenceAudioMime: source.referenceAudio.referenceAudioMime,
          languageHints: source.referenceAudio.languageHints,
          preferredName: source.referenceAudio.preferredName,
          text: source.referenceAudio.text,
        }, false);
      }
      if (source.oneofKind === 'textDescription') {
        return validateScenarioSpec({
          type: 'voice-create', creationSource: 'text-description',
          instructionText: source.textDescription.instructionText,
          previewText: source.textDescription.previewText,
          language: source.textDescription.language,
          preferredName: source.textDescription.preferredName,
        }, false);
      }
      return adapterInputError('voice create source is invalid');
    }
    case 'musicGenerate':
      requireScenarioType(request, ScenarioType.MUSIC_GENERATE);
      if (spec.musicGenerate.negativePrompt || spec.musicGenerate.style || spec.musicGenerate.title
        || spec.musicGenerate.durationSeconds !== 0 || spec.musicGenerate.instrumental) {
        return adapterInputError('unsupported MiniMax-Music3 fields are unavailable to Local Apps');
      }
      return validateScenarioSpec({ type: 'music-generate', prompt: spec.musicGenerate.prompt, lyrics: spec.musicGenerate.lyrics }, false);
    default:
      return adapterInputError(`Scenario type ${spec.oneofKind} is unavailable to Local Apps`);
  }
}

function runtimeVideoSpec(spec: Extract<ScenarioSpec['spec'], { oneofKind: 'videoGenerate' }>['videoGenerate']): NimiLocalAppScenarioJobSpec {
  const options = spec.options!;
  return {
    type: 'video-generate', prompt: spec.prompt, negativePrompt: spec.negativePrompt,
    mode: videoModeName(spec.mode), content: spec.content.map((entry) => {
      const role = videoRoleName(entry.role);
      if (entry.type === VideoContentType.TEXT) return { type: 'text', role, text: entry.text };
      if (entry.type === VideoContentType.IMAGE_URL && entry.imageUrl) return { type: 'image-url', role, url: entry.imageUrl.url };
      if (entry.type === VideoContentType.VIDEO_URL && entry.videoUrl) return { type: 'video-url', role, url: entry.videoUrl.url };
      if (entry.type === VideoContentType.AUDIO_URL && entry.audioUrl) return { type: 'audio-url', role, url: entry.audioUrl.url };
      if (entry.type === VideoContentType.ARTIFACT_REF && entry.artifactRef) return { type: 'artifact-ref', role, artifactId: entry.artifactRef.artifactId };
      return adapterInputError('video content does not match its type');
    }),
    options: {
      resolution: options.resolution, ratio: options.ratio,
      ...(options.durationSec !== undefined ? { durationSec: options.durationSec } : {}),
      ...(options.frames !== undefined ? { frames: options.frames } : {}),
      ...(options.fps !== undefined ? { fps: options.fps } : {}),
      ...(options.seed !== undefined ? { seed: safeOptionalVideoSeed(options.seed) } : {}),
      ...(options.cameraFixed !== undefined ? { cameraFixed: options.cameraFixed } : {}),
      ...(options.watermark !== undefined ? { watermark: options.watermark } : {}),
      ...(options.generateAudio !== undefined ? { generateAudio: options.generateAudio } : {}),
      ...(options.draft !== undefined ? { draft: options.draft } : {}),
      ...(options.returnLastFrame !== undefined ? { returnLastFrame: options.returnLastFrame } : {}),
    },
  };
}

function runtimeSpeechSynthesizeSpec(spec: Extract<ScenarioSpec['spec'], { oneofKind: 'speechSynthesize' }>['speechSynthesize']): NimiLocalAppScenarioJobSpec {
  let voiceRef: Extract<NimiLocalAppScenarioJobSpec, { type: 'speech-synthesize' }>['voiceRef'] = null;
  if (spec.voiceRef) {
    if (spec.voiceRef.kind === VoiceReferenceKind.PRESET && spec.voiceRef.reference.oneofKind === 'presetVoiceId') voiceRef = { type: 'preset', id: spec.voiceRef.reference.presetVoiceId };
    else if (spec.voiceRef.kind === VoiceReferenceKind.VOICE_ASSET && spec.voiceRef.reference.oneofKind === 'voiceAssetId') voiceRef = { type: 'voice-asset', id: spec.voiceRef.reference.voiceAssetId };
    else adapterInputError('provider voice references are unavailable to Local Apps');
  }
  return {
    type: 'speech-synthesize', text: spec.text, language: spec.language,
    audioFormat: spec.audioFormat,
    ...(spec.sampleRateHz !== undefined ? { sampleRateHz: spec.sampleRateHz } : {}),
    ...(spec.speed !== undefined ? { speed: spec.speed } : {}),
    ...(spec.pitch !== undefined ? { pitch: spec.pitch } : {}),
    ...(spec.volume !== undefined ? { volume: spec.volume } : {}),
    emotion: spec.emotion, voiceRef, timingMode: speechTimingName(spec.timingMode),
    voiceRenderHints: spec.voiceRenderHints ? { ...spec.voiceRenderHints } : null,
  };
}

function runtimeSpeechTranscribeSpec(spec: Extract<ScenarioSpec['spec'], { oneofKind: 'speechTranscribe' }>['speechTranscribe']): NimiLocalAppScenarioJobSpec {
  const source = spec.audioSource?.source;
  if (!source || source.oneofKind === undefined || source.oneofKind === 'audioChunks') adapterInputError('Local App transcription requires bytes or URI audio');
  return {
    type: 'speech-transcribe', mimeType: spec.mimeType, language: spec.language,
    ...(spec.timestamps !== undefined ? { timestamps: spec.timestamps } : {}),
    ...(spec.diarization !== undefined ? { diarization: spec.diarization } : {}),
    ...(spec.speakerCount !== undefined ? { speakerCount: spec.speakerCount } : {}),
    prompt: spec.prompt, responseFormat: spec.responseFormat,
    audioSource: source.oneofKind === 'audioBytes'
      ? { type: 'bytes', bytes: [...source.audioBytes] }
      : { type: 'uri', uri: source.audioUri },
  };
}

function runtimeVoiceAudio(bytes: Uint8Array, uri: string): Extract<NimiLocalAppScenarioJobSpec, { creationSource: 'reference-audio' }>['referenceAudio'] {
  if (bytes.length > 0 === Boolean(uri)) adapterInputError('voice reference audio must select exactly one source');
  return bytes.length > 0 ? { type: 'bytes', bytes: [...bytes] } : { type: 'uri', uri };
}

function runtimeJobFromLocal(job: NimiLocalAppScenarioJob): ScenarioJob {
  return {
    jobId: job.jobId, head: undefined, scenarioType: runtimeScenarioType(job.scenarioType), executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: RoutePolicy.UNSPECIFIED, modelResolved: '', status: runtimeJobStatus(job.status), providerJobId: '',
    reasonCode: runtimeReasonCode(job.reasonCode), reasonDetail: job.reasonDetail, retryCount: 0,
    createdAt: runtimeTimestamp(job.createdAt), updatedAt: runtimeTimestamp(job.updatedAt), nextPollAt: undefined,
    artifacts: job.artifacts.map((artifact) => runtimeArtifactFromLocal(artifact)), usage: undefined, traceId: job.traceId,
    ignoredExtensions: [], reasonMetadata: undefined, progressPercent: job.progressPercent,
    progressCurrentStep: job.progressCurrentStep, progressTotalSteps: job.progressTotalSteps,
    transcriptionText: job.transcriptionText,
  };
}

function runtimeVoiceAssetFromLocal(asset: NimiLocalAppVoiceAsset): NimiProtectedLocalVoiceAsset {
  return {
    voiceAssetId: asset.voiceAssetId,
    status: runtimeVoiceAssetStatus(asset.status),
    createdAt: runtimeTimestamp(asset.createdAt),
    updatedAt: runtimeTimestamp(asset.updatedAt),
    expiresAt: runtimeTimestamp(asset.expiresAt),
    creationSource: runtimeVoiceCreationSource(asset.creationSource),
  };
}

function runtimeArtifactFromLocal(artifact: NimiLocalAppScenarioArtifact, bytes: Uint8Array = Uint8Array.from(artifact.bytes), mimeType = artifact.mimeType, sizeBytes = artifact.sizeBytes): ScenarioArtifact {
  return { artifactId: artifact.artifactId, mimeType, bytes, uri: '', sha256: artifact.sha256, sizeBytes: String(sizeBytes), durationMs: String(artifact.durationMs), fps: 0, width: artifact.width, height: artifact.height, sampleRateHz: artifact.sampleRateHz, channels: artifact.channels, speechAlignment: undefined, metadata: undefined };
}

function runtimeJobEventFromLocal(event: NimiLocalAppScenarioJobEvent): ScenarioJobEvent {
  return { eventType: runtimeJobEventType(event.eventType), sequence: event.sequence, traceId: event.traceId, timestamp: runtimeTimestamp(event.timestamp), job: runtimeJobFromLocal(event.job) };
}

function runtimeArtifactResponse(job: NimiLocalAppScenarioJob, artifacts: ScenarioArtifact[]): GetScenarioArtifactsResponse {
  const output = runtimeOutput(job.scenarioType, artifacts, job.transcriptionText);
  return { jobId: job.jobId, artifacts, traceId: job.traceId, output };
}

function runtimeOutput(type: NimiLocalAppScenarioJob['scenarioType'], artifacts: ScenarioArtifact[], transcriptionText: string): ScenarioOutput | undefined {
  switch (type) {
    case 'image-generate': return { output: { oneofKind: 'imageGenerate', imageGenerate: { artifacts } } };
    case 'video-generate': return { output: { oneofKind: 'videoGenerate', videoGenerate: { artifacts } } };
    case 'speech-synthesize': return { output: { oneofKind: 'speechSynthesize', speechSynthesize: { artifacts } } };
    case 'speech-transcribe': {
      if (!transcriptionText.trim() || utf8Length(transcriptionText) > MAX_RESULT_BYTES) localAppProjectionError('speech transcription text');
      return { output: { oneofKind: 'speechTranscribe', speechTranscribe: { text: transcriptionText, artifacts } } };
    }
    case 'music-generate': return { output: { oneofKind: 'musicGenerate', musicGenerate: { artifacts } } };
    default: return undefined;
  }
}

function runtimeScenarioType(type: NimiLocalAppScenarioJob['scenarioType']): ScenarioType {
  return ({ 'image-generate': ScenarioType.IMAGE_GENERATE, 'video-generate': ScenarioType.VIDEO_GENERATE, 'speech-synthesize': ScenarioType.SPEECH_SYNTHESIZE, 'speech-transcribe': ScenarioType.SPEECH_TRANSCRIBE, 'voice-create': ScenarioType.VOICE_CREATE, 'music-generate': ScenarioType.MUSIC_GENERATE })[type];
}

function runtimeJobStatus(status: NimiLocalAppScenarioJob['status']): ScenarioJobStatus {
  return ({ submitted: ScenarioJobStatus.SUBMITTED, queued: ScenarioJobStatus.QUEUED, running: ScenarioJobStatus.RUNNING, completed: ScenarioJobStatus.COMPLETED, failed: ScenarioJobStatus.FAILED, canceled: ScenarioJobStatus.CANCELED, timeout: ScenarioJobStatus.TIMEOUT })[status];
}

function runtimeVoiceAssetStatus(status: NimiLocalAppVoiceAsset['status']): VoiceAssetStatus {
  return ({
    active: VoiceAssetStatus.ACTIVE,
    expired: VoiceAssetStatus.EXPIRED,
    deleted: VoiceAssetStatus.DELETED,
    failed: VoiceAssetStatus.FAILED,
  })[status];
}

function runtimeVoiceCreationSource(source: NimiLocalAppVoiceAsset['creationSource']): VoiceCreationSource {
  return source === 'reference-audio'
    ? VoiceCreationSource.REFERENCE_AUDIO
    : VoiceCreationSource.TEXT_DESCRIPTION;
}

function runtimeJobEventType(type: NimiLocalAppScenarioJobEvent['eventType']): ScenarioJobEventType {
  return ({ submitted: ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED, queued: ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED, running: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING, completed: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED, failed: ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED, canceled: ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED, timeout: ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT })[type];
}

function runtimeReasonCode(value: string): RuntimeReasonCode {
  if (!value) return RuntimeReasonCode.REASON_CODE_UNSPECIFIED;
  const key = value.replace(/[^a-z0-9]+/giu, '_').replace(/^_|_$/gu, '').toUpperCase();
  const code = RuntimeReasonCode[key as keyof typeof RuntimeReasonCode];
  return typeof code === 'number' ? code : RuntimeReasonCode.REASON_CODE_UNSPECIFIED;
}

function runtimeTimestamp(value: NimiLocalAppScenarioTimestamp | null): Timestamp | undefined {
  return value ? { seconds: value.seconds, nanos: value.nanos } : undefined;
}

function projectTimestamp(value: unknown, field: string): NimiLocalAppScenarioTimestamp | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['seconds', 'nanos'], field);
  if (!record || typeof record.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(record.seconds)) localAppProjectionError(field);
  return Object.freeze({ seconds: record.seconds, nanos: projectionInteger(record.nanos, field, 0, 999_999_999) });
}

function requireScenarioType(request: SubmitScenarioJobRequest, expected: ScenarioType): void {
  if (request.scenarioType !== expected) adapterInputError('Scenario type does not match spec');
}

function videoModeName(value: VideoMode): Extract<NimiLocalAppScenarioJobSpec, { type: 'video-generate' }>['mode'] {
  if (value === VideoMode.T2V) return 't2v';
  if (value === VideoMode.I2V_FIRST_FRAME) return 'i2v-first-frame';
  if (value === VideoMode.I2V_FIRST_LAST) return 'i2v-first-last';
  if (value === VideoMode.I2V_REFERENCE) return 'i2v-reference';
  return adapterInputError('video mode is invalid');
}

function videoRoleName(value: VideoContentRole): NimiLocalAppVideoContentRole {
  const roles: Partial<Record<VideoContentRole, NimiLocalAppVideoContentRole>> = { [VideoContentRole.PROMPT]: 'prompt', [VideoContentRole.FIRST_FRAME]: 'first-frame', [VideoContentRole.LAST_FRAME]: 'last-frame', [VideoContentRole.REFERENCE_IMAGE]: 'reference-image', [VideoContentRole.REFERENCE_VIDEO]: 'reference-video', [VideoContentRole.REFERENCE_AUDIO]: 'reference-audio' };
  return roles[value] ?? adapterInputError('video content role is invalid');
}

function speechTimingName(value: SpeechTimingMode): Extract<NimiLocalAppScenarioJobSpec, { type: 'speech-synthesize' }>['timingMode'] {
  if (value === SpeechTimingMode.NONE || value === SpeechTimingMode.UNSPECIFIED) return 'none';
  if (value === SpeechTimingMode.WORD) return 'word';
  if (value === SpeechTimingMode.CHAR) return 'char';
  return adapterInputError('speech timing mode is invalid');
}

function safeOptionalInt64(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) adapterInputError(`${field} is invalid`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) adapterInputError(`${field} exceeds the Local App integer bound`);
  return number;
}

function safeOptionalSignedInt64(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|-?[1-9][0-9]*)$/u.test(value)) adapterInputError(`${field} is invalid`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) adapterInputError(`${field} exceeds the Local App integer carrier bound`);
  return number;
}

function safeOptionalVideoSeed(value: string): number {
  return value === '-1' ? -1 : safeOptionalInt64(value, 'video seed') as number;
}

function boundedIdentifier(value: unknown, field: string): string {
  const text = requireText(value, field);
  if (utf8Length(text) > MAX_IDENTIFIER_BYTES || hasControl(text)) invalidAIInput(`${field} is invalid`);
  return text;
}

function boundedContent(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || utf8Length(value) > maximum || value.includes('\0')) invalidAIInput(`${field} is invalid`);
  return value;
}

function optionalBoundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || utf8Length(value) > maximum || value.includes('\0')) invalidAIInput(`${field} is invalid`);
  return value;
}

function boundedToken(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || utf8Length(value) > maximum || hasControl(value)) invalidAIInput(`${field} is invalid`);
  return value;
}

function boundedHttpsUrl(value: unknown, field: string): string {
  const text = boundedContent(value, field, 2048);
  try { if (new URL(text).protocol !== 'https:') invalidAIInput(`${field} must use https`); } catch { invalidAIInput(`${field} is invalid`); }
  return text;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalidAIInput(`${field} is invalid`);
  return value;
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalidAIInput(`${field} is invalid`);
  return value;
}

function optionalBoundedInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  return value === undefined ? undefined : boundedInteger(value, field, minimum, maximum);
}

function optionalBoundedNumber(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  return value === undefined ? undefined : boundedNumber(value, field, minimum, maximum);
}

function validateByteArray(value: unknown, field: string, maximum: number, allowEmpty: boolean): readonly number[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum
    || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) invalidAIInput(`${field} is invalid`);
  return value;
}

function validateProjectionBytes(value: unknown, field: string): readonly number[] {
  if (!Array.isArray(value) || value.length > MAX_ARTIFACT_BYTES
    || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) localAppProjectionError(field);
  return Object.freeze([...value] as number[]);
}

function projectionInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) localAppProjectionError(field);
  return value;
}

function boundedProjectionText(value: unknown, field: string, maximum: number): string {
  const text = projectionText(value, field);
  if (utf8Length(text) > maximum || hasControl(text)) localAppProjectionError(field);
  return text;
}

function optionalProjectionText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || utf8Length(value) > maximum || hasControl(value)) localAppProjectionError(field);
  return value;
}

function boundedProjectionContent(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value || utf8Length(value) > maximum || value.includes('\0')) {
    localAppProjectionError(field);
  }
  return value;
}

function mimeProjection(value: unknown): string {
  const mime = boundedProjectionText(value, 'artifact mimeType', 128);
  if (!mime.includes('/')) localAppProjectionError('artifact mimeType');
  return mime;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function');
}

function hasControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidAIInput(reason: string): never {
  return localAppError(`Local-app AI input is invalid: ${reason}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_exact_local_app_ai_input');
}

function adapterInputError(reason: string): never {
  return localAppError(`Runtime Scenario Job cannot use the Local App carrier: ${reason}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'use_admitted_local_app_scenario_fields');
}
