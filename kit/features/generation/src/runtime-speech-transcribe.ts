import {
  ReasonCode,
  RoutePolicy,
  ScenarioJobStatus,
  asNimiError,
  buildNimiRuntimeScenarioJobIdentity,
  createNimiError,
  runNimiRuntimeSpeechTranscription,
  type NimiError,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeSpeechTranscriptionAudioSource,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeUnavailableReasonFromError } from './runtime-diagnostics.js';

export type RuntimeSpeechTranscribeUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeSpeechTranscribeAudioInput =
  | { readonly type: 'bytes'; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly type: 'url'; readonly url: string; readonly mimeType?: string }
  | { readonly type: 'chunks'; readonly chunks: readonly Uint8Array[]; readonly mimeType: string };

export type RuntimeSpeechTranscribeOutput = {
  readonly kind: 'transcript';
  readonly text: string;
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
};

export type RuntimeSpeechTranscribeSuccess = {
  readonly ok: true;
  readonly capabilityId: 'audio.transcribe';
  readonly message: string;
  readonly output: RuntimeSpeechTranscribeOutput;
  readonly trace?: {
    readonly traceId?: string;
    readonly modelResolved?: string;
    readonly routeDecision?: string;
  };
};

export type RuntimeSpeechTranscribeUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'audio.transcribe';
  readonly reason: RuntimeSpeechTranscribeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeSpeechTranscribeResult =
  | RuntimeSpeechTranscribeSuccess
  | RuntimeSpeechTranscribeUnavailable;

export type RuntimeSpeechTranscribeRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
};

export type RuntimeSpeechTranscribeInput = {
  readonly runtime: RuntimeSpeechTranscribeRuntime;
  readonly appId: string;
  readonly audio?: RuntimeSpeechTranscribeAudioInput;
  readonly audioUrl?: string;
  readonly mimeType?: string;
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly diarization?: boolean;
  readonly speakerCount?: number;
  readonly prompt?: string;
  readonly responseFormat?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Executes owner-driven audio.transcribe through the Runtime Scenario job API. */
export async function runRuntimeSpeechTranscribe(
  input: RuntimeSpeechTranscribeInput,
): Promise<RuntimeSpeechTranscribeResult> {
  try {
    const audioInput = speechTranscriptionAudio(input);
    const identity = buildNimiRuntimeScenarioJobIdentity({
      appId: input.appId,
      capabilityId: 'audio.transcribe',
      scenarioId: input.scenarioId,
    });
    const result = await runNimiRuntimeSpeechTranscription({
      runtime: { ai: input.runtime.ai },
      head: {
        appId: input.appId,
        ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {}),
      },
      audio: audioInput.audio,
      mimeType: audioInput.mimeType,
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.timestamps !== undefined ? { timestamps: input.timestamps } : {}),
      ...(input.diarization !== undefined ? { diarization: input.diarization } : {}),
      ...(input.speakerCount !== undefined ? { speakerCount: input.speakerCount } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.responseFormat !== undefined ? { responseFormat: input.responseFormat } : {}),
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: speechTranscribeLabels(input),
      ...(input.callOptions !== undefined ? { callOptions: input.callOptions } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.abortReason !== undefined ? { abortReason: input.abortReason } : {}),
      ...(input.onJobUpdate !== undefined ? { onJobUpdate: input.onJobUpdate } : {}),
    });
    const trace = speechTranscribeTrace(result.job, result.traceId);
    return {
      ok: true,
      capabilityId: 'audio.transcribe',
      message: result.text,
      output: {
        kind: 'transcript',
        text: result.text,
        jobId: result.job.jobId,
        jobStatus: speechJobStatusName(result.job.status),
        artifactCount: result.artifacts.length,
      },
      ...(trace ? { trace } : {}),
    };
  } catch (cause) {
    const error = asNimiError(cause, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_speech_transcription',
      source: 'runtime',
    });
    return {
      ok: false,
      capabilityId: 'audio.transcribe',
      reason: speechUnavailableReasonFromError(error),
      message: error.message,
      error,
    };
  }
}

function speechTranscriptionAudio(input: RuntimeSpeechTranscribeInput): {
  readonly audio: NimiRuntimeSpeechTranscriptionAudioSource;
  readonly mimeType: string;
} {
  if (input.audio) {
    const audio = input.audio.type === 'bytes'
      ? { type: 'bytes' as const, bytes: input.audio.bytes }
      : input.audio.type === 'chunks'
        ? { type: 'chunks' as const, chunks: input.audio.chunks }
        : { type: 'url' as const, url: input.audio.url };
    return {
      audio,
      mimeType: normalizeText(input.audio.mimeType) || normalizeText(input.mimeType),
    };
  }
  const audioUrl = normalizeText(input.audioUrl);
  if (audioUrl) {
    return {
      audio: { type: 'url', url: audioUrl },
      mimeType: normalizeText(input.mimeType),
    };
  }
  throw createNimiError({
    message: 'Speech transcription requires an audio source.',
    code: 'SDK_GENERATION_AUDIO_SOURCE_INVALID',
    reasonCode: 'SDK_GENERATION_AUDIO_SOURCE_INVALID',
    actionHint: 'provide_transcription_audio',
    source: 'sdk',
  });
}

function speechTranscribeLabels(input: RuntimeSpeechTranscribeInput): Record<string, string> {
  return Object.fromEntries(Object.entries({
    scenarioId: input.scenarioId,
    surfaceId: input.surfaceId,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
}

function speechTranscribeTrace(
  job: ScenarioJob,
  traceId: string | undefined,
): RuntimeSpeechTranscribeSuccess['trace'] | undefined {
  const resolvedTraceId = normalizeText(traceId) || normalizeText(job.traceId);
  const modelResolved = normalizeText(job.modelResolved);
  const routeDecision = RoutePolicy[job.routeDecision] || '';
  if (!resolvedTraceId && !modelResolved && !routeDecision) {
    return undefined;
  }
  return {
    ...(resolvedTraceId ? { traceId: resolvedTraceId } : {}),
    ...(modelResolved ? { modelResolved } : {}),
    ...(routeDecision ? { routeDecision } : {}),
  };
}

function speechJobStatusName(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function speechUnavailableReasonFromError(error: NimiError): RuntimeSpeechTranscribeUnavailableReason {
  const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
  if (reasonCode === ReasonCode.SDK_AI_INPUT_INVALID || reasonCode.startsWith('SDK_GENERATION_')) {
    return 'input-invalid';
  }
  return runtimeUnavailableReasonFromError(error);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
