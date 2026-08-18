import {
  ReasonCode,
  RoutePolicy,
  ScenarioJobStatus,
  asNimiError,
  buildNimiRuntimeScenarioJobIdentity,
  runNimiRuntimeSpeechSynthesis,
  toNimiRuntimeVoiceReference,
  type NimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiScenarioJobClient,
  type NimiRuntimeSpeechVoiceReference,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runtimeScenarioJobUnavailableReasonFromError,
  type RuntimeScenarioJobUnavailableReason,
} from './runtime-diagnostics.js';

export type RuntimeSpeechSynthesizeUnavailableReason =
  | RuntimeScenarioJobUnavailableReason
  | 'input-invalid';

export type RuntimeSpeechSynthesizeArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: 'hosted-uri' | 'inline-bytes' | 'metadata-only';
  readonly sizeBytes?: number;
};

export type RuntimeSpeechSynthesizeTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeSpeechSynthesizeOutput = {
  readonly kind: 'audio-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeSpeechSynthesizeArtifactSummary;
  readonly artifacts: readonly RuntimeSpeechSynthesizeArtifactSummary[];
};

export type RuntimeSpeechSynthesizeSuccess = {
  readonly ok: true;
  readonly capabilityId: 'audio.synthesize';
  readonly message: string;
  readonly output: RuntimeSpeechSynthesizeOutput;
  readonly trace?: RuntimeSpeechSynthesizeTrace;
};

export type RuntimeSpeechSynthesizeUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'audio.synthesize';
  readonly reason: RuntimeSpeechSynthesizeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeSpeechSynthesizeResult =
  | RuntimeSpeechSynthesizeSuccess
  | RuntimeSpeechSynthesizeUnavailable;

export type RuntimeSpeechSynthesizeRuntime = {
  readonly ai: NimiScenarioJobClient;
};

export type RuntimeSpeechSynthesizeInput = {
  readonly runtime: RuntimeSpeechSynthesizeRuntime;
  readonly appId: string;
  readonly text: string;
  readonly voiceRef?: NimiRuntimeSpeechVoiceReference;
  readonly language?: string;
  readonly audioFormat?: string;
  readonly sampleRateHz?: number;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly emotion?: string;
  readonly timingMode?: 'unspecified' | 'none' | 'word' | 'char';
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Executes owner-driven audio.synthesize through the Runtime Scenario job API. */
export async function runRuntimeSpeechSynthesize(
  input: RuntimeSpeechSynthesizeInput,
): Promise<RuntimeSpeechSynthesizeResult> {
  try {
    const identity = buildNimiRuntimeScenarioJobIdentity({
      appId: input.appId,
      capabilityId: 'audio.synthesize',
      scenarioId: input.scenarioId,
    });
    const result = await runNimiRuntimeSpeechSynthesis({
      runtime: { ai: input.runtime.ai },
      head: {
        appId: input.appId,
        ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {}),
      },
      text: input.text,
      ...(input.voiceRef !== undefined ? { voiceRef: toNimiRuntimeVoiceReference(input.voiceRef) } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.audioFormat !== undefined ? { audioFormat: input.audioFormat } : {}),
      ...(input.sampleRateHz !== undefined ? { sampleRateHz: input.sampleRateHz } : {}),
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
      ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
      ...(input.volume !== undefined ? { volume: input.volume } : {}),
      ...(input.emotion !== undefined ? { emotion: input.emotion } : {}),
      ...(input.timingMode !== undefined ? { timingMode: input.timingMode } : {}),
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: speechSynthesizeLabels(input),
      ...(input.callOptions !== undefined ? { callOptions: input.callOptions } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.abortReason !== undefined ? { abortReason: input.abortReason } : {}),
      ...(input.onJobUpdate !== undefined ? { onJobUpdate: input.onJobUpdate } : {}),
    });
    const artifacts = result.artifacts.map(toSpeechArtifactSummary);
    const trace = speechSynthesizeTrace(result.job, result.traceId);
    return {
      ok: true,
      capabilityId: 'audio.synthesize',
      message: artifacts.length === 1
        ? 'Runtime audio.synthesize completed with 1 artifact.'
        : `Runtime audio.synthesize completed with ${artifacts.length} artifacts.`,
      output: {
        kind: 'audio-artifacts',
        jobId: result.job.jobId,
        jobStatus: speechJobStatusName(result.job.status),
        artifactCount: artifacts.length,
        ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
        artifacts,
      },
      ...(trace ? { trace } : {}),
    };
  } catch (cause) {
    const error = asNimiError(cause, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_speech_synthesis',
      source: 'runtime',
    });
    return {
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: speechUnavailableReasonFromError(error),
      message: error.message,
      error,
    };
  }
}

function speechSynthesizeLabels(input: RuntimeSpeechSynthesizeInput): Record<string, string> {
  return Object.fromEntries(Object.entries({
    scenarioId: input.scenarioId,
    surfaceId: input.surfaceId,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
}

function toSpeechArtifactSummary(
  artifact: NimiRuntimeScenarioArtifact,
): RuntimeSpeechSynthesizeArtifactSummary {
  const mimeType = normalizeText(artifact.mimeType) || 'audio/mpeg';
  const uri = normalizeText(artifact.uri);
  const artifactId = normalizeText(artifact.artifactId);
  const sizeBytes = speechArtifactSize(artifact);
  const base = {
    ...(artifactId ? { artifactId } : {}),
    mimeType,
    ...(uri ? { uri } : {}),
    ...(sizeBytes > 0 ? { sizeBytes } : {}),
  };
  if (uri) {
    return { ...base, previewUrl: uri, previewSource: 'hosted-uri' };
  }
  if (artifact.bytes.length > 0) {
    return {
      ...base,
      previewUrl: `data:${mimeType};base64,${bytesToBase64(artifact.bytes)}`,
      previewSource: 'inline-bytes',
    };
  }
  return { ...base, previewSource: 'metadata-only' };
}

function speechArtifactSize(artifact: NimiRuntimeScenarioArtifact): number {
  const declared = Number(normalizeText(artifact.sizeBytes));
  if (Number.isFinite(declared) && declared > 0) {
    return declared;
  }
  return artifact.bytes.length;
}

function speechSynthesizeTrace(
  job: ScenarioJob,
  traceId: string | undefined,
): RuntimeSpeechSynthesizeTrace | undefined {
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

function speechUnavailableReasonFromError(error: NimiError): RuntimeSpeechSynthesizeUnavailableReason {
  const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
  if (
    reasonCode === ReasonCode.SDK_AI_INPUT_INVALID
    || reasonCode.startsWith('SDK_GENERATION_')
    || reasonCode.startsWith('SDK_RUNTIME_VOICE_REF_')
  ) {
    return 'input-invalid';
  }
  return runtimeScenarioJobUnavailableReasonFromError(error);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
