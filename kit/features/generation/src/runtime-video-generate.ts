import {
  ReasonCode,
  RoutePolicy,
  ScenarioJobStatus,
  asNimiError,
  buildNimiRuntimeScenarioJobIdentity,
  runNimiRuntimeVideoGeneration,
  type NimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiScenarioJobClient,
  type NimiRuntimeVideoContentPart,
  type NimiRuntimeVideoGenerationOptions,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeUnavailableReasonFromError } from './runtime-diagnostics.js';

export type RuntimeVideoGenerateUnavailableReason =
  | 'input-invalid'
  | 'runtime-canceled'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeVideoGenerateArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: 'hosted-uri' | 'inline-bytes' | 'metadata-only';
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
};

export type RuntimeVideoGenerateOutput = {
  readonly kind: 'video-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeVideoGenerateArtifactSummary;
  readonly artifacts: readonly RuntimeVideoGenerateArtifactSummary[];
};

export type RuntimeVideoGenerateSuccess = {
  readonly ok: true;
  readonly capabilityId: 'video.generate';
  readonly message: string;
  readonly output: RuntimeVideoGenerateOutput;
  readonly trace?: {
    readonly traceId?: string;
    readonly modelResolved?: string;
    readonly routeDecision?: string;
  };
};

export type RuntimeVideoGenerateUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'video.generate';
  readonly reason: RuntimeVideoGenerateUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeVideoGenerateResult = RuntimeVideoGenerateSuccess | RuntimeVideoGenerateUnavailable;

export type RuntimeVideoGenerateRuntime = {
  readonly ai: NimiScenarioJobClient;
};

export type RuntimeVideoGenerateInput = {
  readonly runtime: RuntimeVideoGenerateRuntime;
  readonly appId: string;
  readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  readonly prompt?: string;
  readonly negativePrompt?: string;
  readonly content?: readonly NimiRuntimeVideoContentPart[];
  readonly options?: NimiRuntimeVideoGenerationOptions;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/**
 * Executes owner-driven video.generate through the Runtime Scenario job API.
 * The request carries App/capability input only; AIConfig route, local
 * configuration, model selection, and execution target remain Runtime-owned.
 */
export async function runRuntimeVideoGenerate(
  input: RuntimeVideoGenerateInput,
): Promise<RuntimeVideoGenerateResult> {
  try {
    const identity = buildNimiRuntimeScenarioJobIdentity({
      appId: input.appId,
      capabilityId: 'video.generate',
      scenarioId: input.scenarioId,
    });
    const result = await runNimiRuntimeVideoGeneration({
      runtime: { ai: input.runtime.ai },
      head: {
        appId: input.appId,
        ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {}),
      },
      mode: input.mode,
      prompt: input.prompt ?? '',
      ...(input.negativePrompt !== undefined ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      options: withVideoAudioDefault(input.options),
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: videoScenarioLabels(input),
      ...(input.callOptions !== undefined ? { callOptions: input.callOptions } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.abortReason !== undefined ? { abortReason: input.abortReason } : {}),
      ...(input.onJobUpdate !== undefined ? { onJobUpdate: input.onJobUpdate } : {}),
    });
    const artifacts = result.artifacts.map(toVideoArtifactSummary);
    const trace = videoGenerateTrace(result.job, result.traceId);
    return {
      ok: true,
      capabilityId: 'video.generate',
      message: artifacts.length === 1
        ? 'Runtime video.generate completed with 1 artifact.'
        : `Runtime video.generate completed with ${artifacts.length} artifacts.`,
      output: {
        kind: 'video-artifacts',
        jobId: result.job.jobId,
        jobStatus: videoJobStatusName(result.job.status),
        artifactCount: artifacts.length,
        ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
        artifacts,
      },
      ...(trace ? { trace } : {}),
    };
  } catch (cause) {
    const error = asNimiError(cause, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_video_execution',
      source: 'runtime',
    });
    return {
      ok: false,
      capabilityId: 'video.generate',
      reason: videoUnavailableReasonFromError(error),
      message: error.message,
      error,
    };
  }
}

/**
 * MiniMax-H3 always renders audio, so the first-party vertical-slice default
 * treats an absent generateAudio flag as true (aligned with the L0 acceptance
 * profile). An explicit false is preserved and fails closed at the Runtime
 * driver instead of being silently overridden.
 */
function withVideoAudioDefault(
  options: NimiRuntimeVideoGenerationOptions | undefined,
): NimiRuntimeVideoGenerationOptions {
  if (options?.generateAudio !== undefined) {
    return options;
  }
  return { ...(options ?? {}), generateAudio: true };
}

function videoScenarioLabels(input: RuntimeVideoGenerateInput): Record<string, string> {
  return Object.fromEntries(Object.entries({
    scenarioId: input.scenarioId,
    surfaceId: input.surfaceId,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
}

function toVideoArtifactSummary(
  artifact: NimiRuntimeScenarioArtifact,
): RuntimeVideoGenerateArtifactSummary {
  const mimeType = normalizeText(artifact.mimeType) || 'video/mp4';
  const uri = normalizeText(artifact.uri);
  const artifactId = normalizeText(artifact.artifactId);
  const sizeBytes = videoArtifactSize(artifact);
  const base = {
    ...(artifactId ? { artifactId } : {}),
    mimeType,
    ...(uri ? { uri } : {}),
    ...(sizeBytes > 0 ? { sizeBytes } : {}),
    ...(artifact.width > 0 ? { width: artifact.width } : {}),
    ...(artifact.height > 0 ? { height: artifact.height } : {}),
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
  // Kit never reads artifact bytes out-of-band; an artifactId-only projection
  // stays metadata-only until a runtime-artifact-read path is admitted.
  return { ...base, previewSource: 'metadata-only' };
}

function videoArtifactSize(artifact: NimiRuntimeScenarioArtifact): number {
  const declared = Number(normalizeText(artifact.sizeBytes));
  if (Number.isFinite(declared) && declared > 0) {
    return declared;
  }
  return artifact.bytes.length;
}

function videoGenerateTrace(
  job: ScenarioJob,
  traceId: string | undefined,
): RuntimeVideoGenerateSuccess['trace'] | undefined {
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

function videoJobStatusName(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function videoUnavailableReasonFromError(error: NimiError): RuntimeVideoGenerateUnavailableReason {
  if (normalizeText(error.details?.scenarioJobStatus) === 'CANCELED') {
    return 'runtime-canceled';
  }
  const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
  if (reasonCode === ReasonCode.SDK_AI_INPUT_INVALID || reasonCode.startsWith('SDK_GENERATION_')) {
    return 'input-invalid';
  }
  return runtimeUnavailableReasonFromError(error);
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
