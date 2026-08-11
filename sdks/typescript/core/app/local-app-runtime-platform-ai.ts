import {
  ExecutionMode,
  ReasonCode as RuntimeReasonCode,
  RoutePolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  VoiceReferenceKind,
  type GetScenarioArtifactsResponse,
  type ScenarioArtifact,
  type ScenarioJob,
  type ScenarioJobEvent,
  type ScenarioOutput,
  type ScenarioSpec,
  type SubmitScenarioJobRequest,
} from '../../core-generated/runtime-typed-client.js';
import type { Timestamp } from '../../core-generated/runtime-protobuf/google/protobuf/timestamp.js';
import type { NimiRuntimeScenarioJobClient } from '../../runtime/scenario-jobs.js';
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
      readonly type: 'voice-clone';
      readonly referenceAudio:
        | { readonly type: 'bytes'; readonly bytes: readonly number[] }
        | { readonly type: 'uri'; readonly uri: string };
      readonly referenceAudioMime: string;
      readonly languageHints: readonly string[];
      readonly preferredName: string;
      readonly text: string;
    }
  | {
      readonly type: 'voice-design';
      readonly instructionText: string;
      readonly previewText: string;
      readonly language: string;
      readonly preferredName: string;
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
  readonly scenarioType: 'image-generate' | 'video-generate' | 'speech-synthesize' | 'speech-transcribe' | 'voice-clone' | 'voice-design';
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
  readonly workflowType: 'voice-clone' | 'voice-design';
  readonly status: 'active' | 'expired' | 'deleted' | 'failed';
  readonly createdAt: NimiLocalAppScenarioTimestamp | null;
  readonly updatedAt: NimiLocalAppScenarioTimestamp | null;
  readonly expiresAt: NimiLocalAppScenarioTimestamp | null;
};

export type NimiLocalAppScenarioExecuteResult =
  | { readonly output: { readonly type: 'text-embed'; readonly vectors: readonly (readonly number[])[] }; readonly traceId: string }
  | { readonly output: { readonly type: 'image-generate'; readonly artifacts: readonly NimiLocalAppScenarioArtifact[] }; readonly traceId: string };

export type NimiLocalAppScenarioJobSubmitResult = {
  readonly job: NimiLocalAppScenarioJob | null;
  readonly asset: NimiLocalAppVoiceAsset | null;
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
    readonly submit: (spec: NimiLocalAppScenarioJobSpec) => Promise<unknown>;
    readonly get: (jobId: string) => Promise<unknown>;
    readonly subscribe: (jobId: string) => Promise<NimiLocalAppShellStream<unknown>>;
    readonly cancel: (jobId: string, reason?: string) => Promise<unknown>;
  };
  readonly artifacts: {
    readonly read: (artifactId: string) => Promise<unknown>;
    readonly upload: (input: { readonly bytes: readonly number[]; readonly mimeType: NimiLocalAppArtifactImageMime }) => Promise<unknown>;
  };
  readonly voiceAssets: {
    readonly list: (input?: { readonly pageSize?: number; readonly pageToken?: string }) => Promise<unknown>;
  };
};

export type NimiLocalAppAIConsumptionClient = {
  readonly text: {
    readonly streamTurn: (input: NimiLocalAppTextCandidateInput) => Promise<NimiLocalAppSubscription<NimiLocalAppTextTurnEvent>>;
  };
  readonly scenario: {
    readonly execute: (spec: NimiLocalAppScenarioExecuteSpec) => Promise<NimiLocalAppScenarioExecuteResult>;
  };
  readonly scenarioJobs: {
    readonly submit: (spec: NimiLocalAppScenarioJobSpec) => Promise<NimiLocalAppScenarioJobSubmitResult>;
    readonly get: (jobId: string) => Promise<{ readonly job: NimiLocalAppScenarioJob }>;
    readonly subscribe: (jobId: string) => Promise<NimiLocalAppSubscription<NimiLocalAppScenarioJobEvent>>;
    readonly cancel: (jobId: string, reason?: string) => Promise<{ readonly job: NimiLocalAppScenarioJob }>;
  };
  readonly artifacts: {
    readonly read: (artifactId: string) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string; readonly sizeBytes: number }>;
    readonly upload: (input: { readonly bytes: Uint8Array; readonly mimeType: NimiLocalAppArtifactImageMime }) => Promise<NimiLocalAppArtifactUploadResult>;
  };
  readonly voiceAssets: {
    readonly list: (input?: { readonly pageSize?: number; readonly pageToken?: string }) => Promise<{ readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string }>;
  };
};

const MAX_RESULT_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_IDENTIFIER_BYTES = 128;

export function createNimiLocalAppAIConsumptionClient(
  shell: NimiLocalAppAIConsumptionShell,
): NimiLocalAppAIConsumptionClient {
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
      submit: async (spec) => projectScenarioJobSubmit(
        await shell.scenarioJobs.submit(validateScenarioSpec(spec, false)),
      ),
      get: async (jobId) => projectScenarioJobEnvelope(
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
    voiceAssets: Object.freeze({
      list: async (input: { readonly pageSize?: number; readonly pageToken?: string } = {}) => {
        assertExactKeys(input, ['pageSize', 'pageToken'], 'voice asset list input');
        assertNoAuthorityMaterial(input);
        const pageSize = input.pageSize ?? 0;
        const pageToken = input.pageToken ?? '';
        if (!Number.isSafeInteger(pageSize) || pageSize < 0 || pageSize > 200
          || typeof pageToken !== 'string' || !/^[0-9]{0,10}$/u.test(pageToken)) {
          invalidAIInput('voice asset page is invalid');
        }
        return projectVoiceAssetsList(await shell.voiceAssets.list({ pageSize, pageToken }));
      },
    }),
  };
  return Object.freeze(client);
}

export function createNimiLocalAppRuntimeScenarioJobClient(
  ai: Pick<NimiLocalAppAIConsumptionClient, 'scenarioJobs' | 'artifacts'>,
): NimiRuntimeScenarioJobClient {
  const client: NimiRuntimeScenarioJobClient = {
    async submitScenarioJob(request) {
      const spec = localJobSpecFromRuntimeRequest(request);
      const result = await ai.scenarioJobs.submit(spec);
      return {
        job: result.job ? runtimeJobFromLocal(result.job) : undefined,
        asset: undefined,
      };
    },
    async getScenarioJob(request) {
      assertExactKeys(request, ['jobId'], 'local-app Scenario Job get request');
      const result = await ai.scenarioJobs.get(request.jobId);
      return { job: runtimeJobFromLocal(result.job) };
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
      assertExactKeys(record, ['type', 'prompt', 'negativePrompt', 'n', 'size', 'aspectRatio', 'quality', 'style', 'seed', 'referenceImages', 'mask', 'responseFormat'], 'image spec');
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
    case 'voice-clone':
      if (execute) invalidAIInput('voice-clone is not a synchronous spec');
      validateVoiceCloneSpec(record);
      break;
    case 'voice-design':
      if (execute) invalidAIInput('voice-design is not a synchronous spec');
      assertExactKeys(record, ['type', 'instructionText', 'previewText', 'language', 'preferredName'], 'voice design spec');
      boundedContent(record.instructionText, 'voice instructionText', 8 * 1024);
      optionalBoundedText(record.previewText, 'voice previewText', 8 * 1024);
      boundedToken(record.language, 'voice language', 64);
      boundedToken(record.preferredName, 'voice preferredName', 256);
      break;
    default:
      invalidAIInput('scenario type is invalid');
  }
  return spec;
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

function validateVoiceCloneSpec(record: Record<string, unknown>): void {
  assertExactKeys(record, ['type', 'referenceAudio', 'referenceAudioMime', 'languageHints', 'preferredName', 'text'], 'voice clone spec');
  validateAudioSource(record.referenceAudio, 20 * 1024 * 1024, 'voice referenceAudio');
  boundedToken(record.referenceAudioMime, 'voice referenceAudioMime', 128);
  if (!Array.isArray(record.languageHints) || record.languageHints.length > 8) invalidAIInput('voice languageHints are invalid');
  record.languageHints.forEach((hint, index) => boundedToken(hint, `voice languageHint ${index}`, 64));
  boundedToken(record.preferredName, 'voice preferredName', 256);
  optionalBoundedText(record.text, 'voice text', 32 * 1024);
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
  assertExactProjectionKeys(record, ['job', 'asset'], 'scenario Job submit');
  if (record.job === null && record.asset === null) localAppProjectionError('scenario Job submit');
  return Object.freeze({
    job: record.job === null ? null : projectScenarioJob(record.job),
    asset: record.asset === null ? null : projectVoiceAsset(record.asset),
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
  assertExactProjectionKeys(record, ['voiceAssetId', 'workflowType', 'status', 'createdAt', 'updatedAt', 'expiresAt'], 'voice asset');
  if (!['voice-clone', 'voice-design'].includes(String(record.workflowType))
    || !['active', 'expired', 'deleted', 'failed'].includes(String(record.status))) localAppProjectionError('voice asset enum');
  return Object.freeze({
    voiceAssetId: boundedProjectionText(record.voiceAssetId, 'voice asset id', MAX_IDENTIFIER_BYTES),
    workflowType: record.workflowType,
    status: record.status,
    createdAt: projectTimestamp(record.createdAt, 'voice asset createdAt'),
    updatedAt: projectTimestamp(record.updatedAt, 'voice asset updatedAt'),
    expiresAt: projectTimestamp(record.expiresAt, 'voice asset expiresAt'),
  }) as NimiLocalAppVoiceAsset;
}

function projectVoiceAssetsList(value: unknown): { readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['assets', 'nextPageToken'], 'voice asset list');
  if (!Array.isArray(record.assets) || record.assets.length > 200
    || typeof record.nextPageToken !== 'string' || !/^[0-9]{0,10}$/u.test(record.nextPageToken)) localAppProjectionError('voice asset list');
  return Object.freeze({ assets: Object.freeze(record.assets.map(projectVoiceAsset)), nextPageToken: record.nextPageToken });
}

const LOCAL_SCENARIO_TYPES = ['image-generate', 'video-generate', 'speech-synthesize', 'speech-transcribe', 'voice-clone', 'voice-design'] as const;
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
    case 'voiceClone':
      requireScenarioType(request, ScenarioType.VOICE_CLONE);
      if (spec.voiceClone.targetModelId) adapterInputError('voice target model is Runtime-derived');
      if (!spec.voiceClone.input) adapterInputError('voice clone input is missing');
      return validateScenarioSpec({ type: 'voice-clone', referenceAudio: runtimeVoiceAudio(spec.voiceClone.input.referenceAudioBytes, spec.voiceClone.input.referenceAudioUri), referenceAudioMime: spec.voiceClone.input.referenceAudioMime, languageHints: spec.voiceClone.input.languageHints, preferredName: spec.voiceClone.input.preferredName, text: spec.voiceClone.input.text }, false);
    case 'voiceDesign':
      requireScenarioType(request, ScenarioType.VOICE_DESIGN);
      if (spec.voiceDesign.targetModelId) adapterInputError('voice target model is Runtime-derived');
      if (!spec.voiceDesign.input) adapterInputError('voice design input is missing');
      return validateScenarioSpec({ type: 'voice-design', instructionText: spec.voiceDesign.input.instructionText, previewText: spec.voiceDesign.input.previewText, language: spec.voiceDesign.input.language, preferredName: spec.voiceDesign.input.preferredName }, false);
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

function runtimeVoiceAudio(bytes: Uint8Array, uri: string): Extract<NimiLocalAppScenarioJobSpec, { type: 'voice-clone' }>['referenceAudio'] {
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
    default: return undefined;
  }
}

function runtimeScenarioType(type: NimiLocalAppScenarioJob['scenarioType']): ScenarioType {
  return ({ 'image-generate': ScenarioType.IMAGE_GENERATE, 'video-generate': ScenarioType.VIDEO_GENERATE, 'speech-synthesize': ScenarioType.SPEECH_SYNTHESIZE, 'speech-transcribe': ScenarioType.SPEECH_TRANSCRIBE, 'voice-clone': ScenarioType.VOICE_CLONE, 'voice-design': ScenarioType.VOICE_DESIGN })[type];
}

function runtimeJobStatus(status: NimiLocalAppScenarioJob['status']): ScenarioJobStatus {
  return ({ submitted: ScenarioJobStatus.SUBMITTED, queued: ScenarioJobStatus.QUEUED, running: ScenarioJobStatus.RUNNING, completed: ScenarioJobStatus.COMPLETED, failed: ScenarioJobStatus.FAILED, canceled: ScenarioJobStatus.CANCELED, timeout: ScenarioJobStatus.TIMEOUT })[status];
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
