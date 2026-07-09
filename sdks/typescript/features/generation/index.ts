import {
  RoutePolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  type CancelScenarioJobRequest,
  type CancelScenarioJobResponse,
  type GetScenarioArtifactsRequest,
  type GetScenarioArtifactsResponse,
  type GetScenarioJobRequest,
  type GetScenarioJobResponse,
  type ReadArtifactBytesRequest,
  type ReadArtifactBytesResponse,
  type ScenarioArtifact,
  type ScenarioJob,
  type ScenarioJobEvent,
  type ScenarioOutput,
  type SubmitScenarioJobRequest,
  type SubmitScenarioJobResponse,
} from '../../core-generated/runtime-typed-client';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import type { NimiJsonObject, NimiJsonValue } from '../../core/contracts';
import { createNimiError, ReasonCode } from '../../types';
import {
  runNimiRuntimeScenarioJob,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeScenarioJobClient,
} from '../../runtime/scenario-jobs';
import {
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
} from './runtime-scenarios';
import type {
  NimiRuntimeGenerationScenario,
  NimiRuntimeSpeechTranscriptionAudioSource,
  NimiRuntimeVideoContentPart,
  NimiRuntimeVideoGenerationOptions,
} from './runtime-scenarios';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  type NimiRuntimeGenerationHeadInput,
  type NimiRuntimeGenerationSubmitInput,
} from './runtime-generation-build';

export {
  createNimiImageGenerationScenario,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
} from './runtime-scenarios';
export type {
  NimiRuntimeGenerationScenario,
  NimiRuntimeSpeechTranscriptionAudioSource,
  NimiRuntimeVideoContentPart,
  NimiRuntimeVideoGenerationOptions,
} from './runtime-scenarios';
export * from './media-params';
export * from './runtime-generation-build';
export * from './runtime-image-generation';
export * from './runtime-job-builders';
export * from './runtime-target-identity';
export * from './voice-reference';

export type NimiGenerationJobStatus =
  | 'submitted'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'unknown';

export interface NimiGenerationArtifact {
  readonly id: string;
  readonly kind: 'image' | 'video' | 'audio' | 'document' | 'other';
  readonly uri?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: string;
  readonly sha256?: string;
  readonly bytes?: Uint8Array;
  readonly metadata?: NimiJsonObject;
}

export interface NimiGenerationJob {
  readonly id: string;
  readonly status: NimiGenerationJobStatus;
  readonly prompt?: string;
  readonly artifacts: readonly NimiGenerationArtifact[];
  readonly error?: string;
  readonly runtime?: {
    readonly scenarioType: number;
    readonly routeDecision: string;
    readonly modelResolved: string;
    readonly providerJobId: string;
    readonly traceId: string;
    readonly progressPercent: number;
  };
}

export function createNimiGenerationJob(input: {
  readonly id: string;
  readonly prompt: string;
  readonly status?: NimiGenerationJobStatus;
}): NimiGenerationJob {
  return {
    id: input.id,
    prompt: input.prompt,
    status: input.status ?? 'queued',
    artifacts: [],
  };
}

export function transitionNimiGenerationJob(
  job: NimiGenerationJob,
  transition: {
    readonly status: NimiGenerationJobStatus;
    readonly artifacts?: readonly NimiGenerationArtifact[];
    readonly error?: string;
  },
): NimiGenerationJob {
  return {
    ...job,
    status: transition.status,
    artifacts: transition.artifacts ?? job.artifacts,
    error: transition.error,
  };
}

export function collectNimiGenerationArtifacts(jobs: readonly NimiGenerationJob[]): readonly NimiGenerationArtifact[] {
  return jobs.flatMap((job) => job.artifacts);
}

export function generationArtifactToJson(artifact: NimiGenerationArtifact): NimiJsonValue {
  return {
    id: artifact.id,
    kind: artifact.kind,
    uri: artifact.uri ?? null,
    mimeType: artifact.mimeType ?? null,
    sizeBytes: artifact.sizeBytes ?? null,
    sha256: artifact.sha256 ?? null,
    metadata: artifact.metadata ?? {},
  };
}

export interface NimiRuntimeGenerationClient {
  submitScenarioJob(request: SubmitScenarioJobRequest, options?: RuntimeTypedCallOptions): Promise<SubmitScenarioJobResponse>;
  getScenarioJob(request: GetScenarioJobRequest, options?: RuntimeTypedCallOptions): Promise<GetScenarioJobResponse>;
  cancelScenarioJob(request: CancelScenarioJobRequest, options?: RuntimeTypedCallOptions): Promise<CancelScenarioJobResponse>;
  subscribeScenarioJobEvents(
    request: { readonly jobId: string },
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<ScenarioJobEvent>;
  getScenarioArtifacts(
    request: GetScenarioArtifactsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetScenarioArtifactsResponse>;
}

export interface NimiRuntimeArtifactClient {
  readArtifactBytes(request: ReadArtifactBytesRequest, options?: RuntimeTypedCallOptions): Promise<ReadArtifactBytesResponse>;
}

export interface NimiRuntimeGenerationClientOptions {
  readonly runtime:
    | NimiRuntimeGenerationClient
    | {
      readonly ai: NimiRuntimeGenerationClient;
      readonly artifacts?: NimiRuntimeArtifactClient;
    };
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly artifacts?: NimiRuntimeArtifactClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeGenerationJobEvent {
  readonly type: 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'unknown';
  readonly sequence: string;
  readonly traceId: string;
  readonly timestamp?: string;
  readonly job: NimiGenerationJob | null;
  readonly raw: ScenarioJobEvent;
}

export interface NimiRuntimeGenerationSurface {
  submit(input: NimiRuntimeGenerationSubmitInput): Promise<NimiGenerationJob>;
  get(jobId: string): Promise<NimiGenerationJob>;
  cancel(jobId: string, reason: string): Promise<NimiGenerationJob>;
  artifacts(jobId: string): Promise<readonly NimiGenerationArtifact[]>;
  readArtifactBytes(artifactId: string): Promise<ReadArtifactBytesResponse>;
  events(jobId: string): AsyncIterable<NimiRuntimeGenerationJobEvent>;
}

type NimiRuntimeScenarioRuntime = NimiRuntimeScenarioJobClient | { readonly ai: NimiRuntimeScenarioJobClient };
type NimiRuntimeSpeechScenarioRuntime = NimiRuntimeScenarioRuntime;
type NimiRuntimeVideoScenarioRuntime = NimiRuntimeScenarioRuntime;
type NimiRuntimeSpeechSynthesisScenarioInput = Extract<
  NimiRuntimeGenerationScenario,
  { readonly kind: 'speech-synthesize' }
>;

export interface NimiRuntimeSpeechSynthesisInput {
  readonly runtime: NimiRuntimeSpeechScenarioRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly text: string;
  readonly voiceRef?: NimiRuntimeSpeechSynthesisScenarioInput['voiceRef'];
  readonly language?: string;
  readonly audioFormat?: string;
  readonly sampleRateHz?: number;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly emotion?: string;
  readonly timingMode?: NimiRuntimeSpeechSynthesisScenarioInput['timingMode'];
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: NimiRuntimeGenerationSubmitInput['extensions'];
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
}

export interface NimiRuntimeSpeechSynthesisOutput {
  readonly artifacts: readonly ScenarioArtifact[];
}

export interface NimiRuntimeSpeechSynthesisResult extends NimiRuntimeSpeechSynthesisOutput {
  readonly job: ScenarioJob;
  readonly traceId?: string;
  readonly output?: ScenarioOutput;
}

export interface NimiRuntimeSpeechTranscriptionInput {
  readonly runtime: NimiRuntimeSpeechScenarioRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly audio: NimiRuntimeSpeechTranscriptionAudioSource;
  readonly mimeType: string;
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly diarization?: boolean;
  readonly speakerCount?: number;
  readonly prompt?: string;
  readonly responseFormat?: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: NimiRuntimeGenerationSubmitInput['extensions'];
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
}

export interface NimiRuntimeSpeechTranscriptionOutput {
  readonly text: string;
  readonly artifacts: readonly ScenarioArtifact[];
}

export interface NimiRuntimeSpeechTranscriptionResult extends NimiRuntimeSpeechTranscriptionOutput {
  readonly job: ScenarioJob;
  readonly traceId?: string;
  readonly output?: ScenarioOutput;
}

export interface NimiRuntimeVideoGenerationInput {
  readonly runtime: NimiRuntimeVideoScenarioRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly mode: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'video' }>['mode'];
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly content?: readonly NimiRuntimeVideoContentPart[];
  readonly options?: NimiRuntimeVideoGenerationOptions;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: NimiRuntimeGenerationSubmitInput['extensions'];
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
}

export interface NimiRuntimeVideoGenerationOutput {
  readonly artifacts: readonly ScenarioArtifact[];
}

export interface NimiRuntimeVideoGenerationResult extends NimiRuntimeVideoGenerationOutput {
  readonly job: ScenarioJob;
  readonly traceId?: string;
  readonly output?: ScenarioOutput;
}

export function createNimiRuntimeGenerationClient(
  options: NimiRuntimeGenerationClientOptions,
): NimiRuntimeGenerationSurface {
  const clients = getRuntimeGenerationClients(options);
  return {
    async submit(input) {
      const request = buildNimiRuntimeGenerationSubmitRequest(options.head, input);
      const response = await clients.ai.submitScenarioJob(
        request,
        withNimiRuntimeIdempotencyMetadata(options.callOptions, request.idempotencyKey),
      );
      return requireRuntimeJob(response.job, 'submitScenarioJob');
    },
    async get(jobId) {
      const response = await clients.ai.getScenarioJob({
        jobId: requireText(jobId, 'Runtime generation get requires jobId', 'provide_generation_job_id'),
      }, options.callOptions);
      return requireRuntimeJob(response.job, 'getScenarioJob');
    },
    async cancel(jobId, reason) {
      const request = {
        jobId: requireText(jobId, 'Runtime generation cancel requires jobId', 'provide_generation_job_id'),
        reason: requireText(reason, 'Runtime generation cancel requires reason', 'provide_generation_cancel_reason'),
      };
      const response = await clients.ai.cancelScenarioJob(
        request,
        withNimiRuntimeIdempotencyMetadata(options.callOptions, `cancel:${request.jobId}:${request.reason}`),
      );
      return requireRuntimeJob(response.job, 'cancelScenarioJob');
    },
    async artifacts(jobId) {
      const response = await clients.ai.getScenarioArtifacts({
        jobId: requireText(jobId, 'Runtime generation artifacts requires jobId', 'provide_generation_job_id'),
      }, options.callOptions);
      return response.artifacts.map(runtimeArtifactToNimiArtifact);
    },
    readArtifactBytes(artifactId) {
      if (!clients.artifacts) {
        throw generationError(
          'SDK_GENERATION_ARTIFACT_CLIENT_REQUIRED',
          'Runtime generation artifact byte reads require Runtime artifacts client',
          'provide_runtime_artifact_client',
        );
      }
      return clients.artifacts.readArtifactBytes({
        artifactId: requireText(artifactId, 'Runtime artifact read requires artifactId', 'provide_artifact_id'),
      }, options.callOptions);
    },
    async *events(jobId) {
      for await (const event of clients.ai.subscribeScenarioJobEvents({
        jobId: requireText(jobId, 'Runtime generation events requires jobId', 'provide_generation_job_id'),
      }, options.callOptions)) {
        yield runtimeJobEventToNimiEvent(event);
      }
    },
  };
}

export async function runNimiRuntimeSpeechSynthesis(
  input: NimiRuntimeSpeechSynthesisInput,
): Promise<NimiRuntimeSpeechSynthesisResult> {
  const ai = getRuntimeScenarioClient(input.runtime);
  const result = await runNimiRuntimeScenarioJob({
    ai,
    request: buildNimiRuntimeGenerationSubmitRequest(input.head, {
      scenario: createNimiSpeechSynthesisScenario({
        kind: 'speech-synthesize',
        text: input.text,
        voiceRef: input.voiceRef,
        language: input.language,
        audioFormat: input.audioFormat,
        sampleRateHz: input.sampleRateHz,
        speed: input.speed,
        pitch: input.pitch,
        volume: input.volume,
        emotion: input.emotion,
        timingMode: input.timingMode,
      }),
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      labels: input.labels,
      extensions: input.extensions,
    }),
    callOptions: input.callOptions,
    signal: input.signal,
    abortReason: input.abortReason,
    onJobUpdate: input.onJobUpdate,
  });
  const synthesis = extractNimiRuntimeSpeechSynthesisOutput(result.output);
  return {
    artifacts: synthesis.artifacts,
    job: result.job,
    traceId: result.traceId || result.job.traceId || undefined,
    output: result.output,
  };
}

export function extractNimiRuntimeSpeechSynthesisOutput(
  output: ScenarioOutput | undefined,
): NimiRuntimeSpeechSynthesisOutput {
  const variant = output?.output;
  if (variant?.oneofKind !== 'speechSynthesize') {
    throw generationError(
      'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
      'Runtime speech synthesis output is missing typed speechSynthesize result',
      'check_runtime_speech_synthesis_output',
    );
  }
  const artifacts = Array.isArray(variant.speechSynthesize.artifacts)
    ? variant.speechSynthesize.artifacts
    : [];
  const audioArtifacts = artifacts.filter(isRuntimeSpeechAudioArtifact);
  if (audioArtifacts.length === 0) {
    throw createNimiError({
      message: 'Runtime speech synthesis returned no audio artifact',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_speech_synthesis',
      source: 'runtime',
    });
  }
  return {
    artifacts: audioArtifacts,
  };
}

export async function runNimiRuntimeSpeechTranscription(
  input: NimiRuntimeSpeechTranscriptionInput,
): Promise<NimiRuntimeSpeechTranscriptionResult> {
  const ai = getRuntimeScenarioClient(input.runtime);
  const result = await runNimiRuntimeScenarioJob({
    ai,
    request: buildNimiRuntimeGenerationSubmitRequest(input.head, {
      scenario: createNimiSpeechTranscriptionScenario({
        kind: 'speech-transcribe',
        mimeType: input.mimeType,
        audio: input.audio,
        language: input.language,
        timestamps: input.timestamps,
        diarization: input.diarization,
        speakerCount: input.speakerCount,
        prompt: input.prompt,
        responseFormat: input.responseFormat,
      }),
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      labels: input.labels,
      extensions: input.extensions,
    }),
    callOptions: input.callOptions,
    signal: input.signal,
    abortReason: input.abortReason,
    onJobUpdate: input.onJobUpdate,
  });
  const transcription = extractNimiRuntimeSpeechTranscriptionOutput(result.output);
  return {
    text: transcription.text,
    artifacts: result.artifacts.length > 0 ? result.artifacts : transcription.artifacts,
    job: result.job,
    traceId: result.traceId || result.job.traceId || undefined,
    output: result.output,
  };
}

export async function runNimiRuntimeVideoGeneration(
  input: NimiRuntimeVideoGenerationInput,
): Promise<NimiRuntimeVideoGenerationResult> {
  const ai = getRuntimeScenarioClient(input.runtime);
  const result = await runNimiRuntimeScenarioJob({
    ai,
    request: buildNimiRuntimeGenerationSubmitRequest(input.head, {
      scenario: createNimiVideoGenerationScenario({
        kind: 'video',
        mode: input.mode,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        content: input.content,
        options: input.options,
      }),
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      labels: input.labels,
      extensions: input.extensions,
    }),
    callOptions: input.callOptions,
    signal: input.signal,
    abortReason: input.abortReason,
    onJobUpdate: input.onJobUpdate,
  });
  const video = extractNimiRuntimeVideoGenerationOutput(result.output);
  return {
    artifacts: result.artifacts.length > 0 ? result.artifacts : video.artifacts,
    job: result.job,
    traceId: result.traceId || result.job.traceId || undefined,
    output: result.output,
  };
}

export function extractNimiRuntimeVideoGenerationOutput(
  output: ScenarioOutput | undefined,
): NimiRuntimeVideoGenerationOutput {
  const variant = output?.output;
  if (variant?.oneofKind !== 'videoGenerate') {
    throw generationError(
      'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
      'Runtime video generation output is missing typed videoGenerate result',
      'check_runtime_video_generation_output',
    );
  }
  const artifacts = Array.isArray(variant.videoGenerate.artifacts)
    ? variant.videoGenerate.artifacts
    : [];
  const videoArtifacts = artifacts.filter(isRuntimeVideoArtifact);
  if (videoArtifacts.length === 0) {
    throw createNimiError({
      message: 'Runtime video generation returned no video artifact',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_video_generation',
      source: 'runtime',
    });
  }
  return {
    artifacts: videoArtifacts,
  };
}

export function extractNimiRuntimeSpeechTranscriptionOutput(
  output: ScenarioOutput | undefined,
): NimiRuntimeSpeechTranscriptionOutput {
  const variant = output?.output;
  if (variant?.oneofKind !== 'speechTranscribe') {
    throw generationError(
      'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
      'Runtime speech transcription output is missing typed speechTranscribe result',
      'check_runtime_speech_transcription_output',
    );
  }
  const text = normalizeText(variant.speechTranscribe.text);
  if (!text) {
    throw createNimiError({
      message: 'Runtime speech transcription returned no transcript text',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_speech_transcription',
      source: 'runtime',
    });
  }
  return {
    text,
    artifacts: Array.isArray(variant.speechTranscribe.artifacts)
      ? variant.speechTranscribe.artifacts
      : [],
  };
}

function isRuntimeSpeechAudioArtifact(artifact: ScenarioArtifact): boolean {
  return normalizeText(artifact.mimeType).startsWith('audio/')
    && (
      normalizeText(artifact.artifactId).length > 0
      || normalizeText(artifact.uri).length > 0
      || artifact.bytes.length > 0
    );
}

function isRuntimeVideoArtifact(artifact: ScenarioArtifact): boolean {
  return normalizeText(artifact.mimeType).startsWith('video/')
    && (
      normalizeText(artifact.artifactId).length > 0
      || normalizeText(artifact.uri).length > 0
      || artifact.bytes.length > 0
    );
}

function requireRuntimeJob(job: ScenarioJob | undefined, method: string): NimiGenerationJob {
  if (!job) {
    throw generationError(
      'SDK_GENERATION_RUNTIME_JOB_MISSING',
      `Runtime ${method} response did not include a ScenarioJob`,
      'check_runtime_generation_job_response',
    );
  }
  return runtimeJobToNimiJob(job);
}

function runtimeJobToNimiJob(job: ScenarioJob): NimiGenerationJob {
  return {
    id: job.jobId,
    status: toNimiGenerationJobStatus(job.status),
    artifacts: job.artifacts.map(runtimeArtifactToNimiArtifact),
    error: job.reasonDetail || undefined,
    runtime: {
      scenarioType: job.scenarioType,
      routeDecision: routePolicyName(job.routeDecision),
      modelResolved: job.modelResolved,
      providerJobId: job.providerJobId,
      traceId: job.traceId,
      progressPercent: job.progressPercent,
    },
  };
}

function runtimeArtifactToNimiArtifact(artifact: ScenarioArtifact): NimiGenerationArtifact {
  return {
    id: artifact.artifactId,
    kind: artifactKindFromMime(artifact.mimeType),
    uri: normalizeText(artifact.uri) || undefined,
    mimeType: normalizeText(artifact.mimeType) || undefined,
    sizeBytes: normalizeText(artifact.sizeBytes) || undefined,
    sha256: normalizeText(artifact.sha256) || undefined,
    bytes: artifact.bytes.length > 0 ? artifact.bytes : undefined,
    metadata: {
      durationMs: normalizeText(artifact.durationMs) || null,
      fps: artifact.fps || null,
      width: artifact.width || null,
      height: artifact.height || null,
      sampleRateHz: artifact.sampleRateHz || null,
      channels: artifact.channels || null,
    },
  };
}

function runtimeJobEventToNimiEvent(event: ScenarioJobEvent): NimiRuntimeGenerationJobEvent {
  return {
    type: toNimiGenerationJobEventType(event.eventType),
    sequence: event.sequence,
    traceId: event.traceId,
    timestamp: timestampToIso(event.timestamp),
    job: event.job ? runtimeJobToNimiJob(event.job) : null,
    raw: event,
  };
}

function toNimiGenerationJobStatus(status: ScenarioJobStatus): NimiGenerationJobStatus {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'submitted';
    case ScenarioJobStatus.QUEUED:
      return 'queued';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'completed';
    case ScenarioJobStatus.FAILED:
      return 'failed';
    case ScenarioJobStatus.CANCELED:
      return 'cancelled';
    case ScenarioJobStatus.TIMEOUT:
      return 'timeout';
    case ScenarioJobStatus.UNSPECIFIED:
    default:
      return 'unknown';
  }
}

function toNimiGenerationJobEventType(eventType: ScenarioJobEventType): NimiRuntimeGenerationJobEvent['type'] {
  switch (eventType) {
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED:
      return 'submitted';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED:
      return 'queued';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING:
      return 'running';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED:
      return 'completed';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED:
      return 'failed';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED:
      return 'cancelled';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT:
      return 'timeout';
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED:
    default:
      return 'unknown';
  }
}

function routePolicyName(policy: RoutePolicy): string {
  if (policy === RoutePolicy.LOCAL) return 'local';
  if (policy === RoutePolicy.CLOUD) return 'cloud';
  return 'unspecified';
}

function artifactKindFromMime(mimeType: string): NimiGenerationArtifact['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return 'document';
  return 'other';
}

function getRuntimeGenerationClients(options: NimiRuntimeGenerationClientOptions): {
  readonly ai: NimiRuntimeGenerationClient;
  readonly artifacts?: NimiRuntimeArtifactClient;
} {
  if ('ai' in options.runtime) {
    return {
      ai: options.runtime.ai,
      artifacts: options.artifacts ?? options.runtime.artifacts,
    };
  }
  return {
    ai: options.runtime,
    artifacts: options.artifacts,
  };
}

function getRuntimeScenarioClient(runtime: NimiRuntimeScenarioRuntime): NimiRuntimeScenarioJobClient {
  if ('ai' in runtime) {
    return runtime.ai;
  }
  return runtime;
}

function timestampToIso(timestamp: { readonly seconds: string; readonly nanos: number } | undefined): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const millis = Number(BigInt(timestamp.seconds) * 1000n + BigInt(Math.floor(timestamp.nanos / 1_000_000)));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw generationError('SDK_GENERATION_FIELD_REQUIRED', message, actionHint);
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function generationError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
