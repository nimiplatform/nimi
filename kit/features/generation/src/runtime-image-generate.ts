import {
  ReasonCode,
  RoutePolicy,
  ScenarioJobStatus,
  asNimiError,
  buildNimiRuntimeScenarioJobIdentity,
  runNimiRuntimeImageGeneration,
  type NimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiScenarioJobClient,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runtimeScenarioJobUnavailableReasonFromError,
  type RuntimeScenarioJobUnavailableReason,
} from './runtime-diagnostics.js';

export type RuntimeImageGenerateUnavailableReason =
  | RuntimeScenarioJobUnavailableReason
  | 'input-invalid';

export type RuntimeImageGenerateArtifactPreviewSource =
  | 'hosted-uri'
  | 'inline-bytes'
  | 'metadata-only';

export type RuntimeImageGenerateArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: RuntimeImageGenerateArtifactPreviewSource;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
};

export type RuntimeImageGenerateTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeImageGenerateOutput = {
  readonly kind: 'image-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeImageGenerateArtifactSummary;
  readonly artifacts: readonly RuntimeImageGenerateArtifactSummary[];
};

export type RuntimeImageGenerateSuccess = {
  readonly ok: true;
  readonly capabilityId: 'image.generate';
  readonly message: string;
  readonly output: RuntimeImageGenerateOutput;
  readonly trace?: RuntimeImageGenerateTrace;
};

export type RuntimeImageGenerateUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'image.generate';
  readonly reason: RuntimeImageGenerateUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeImageGenerateResult = RuntimeImageGenerateSuccess | RuntimeImageGenerateUnavailable;

export type RuntimeImageGenerateRuntime = {
  readonly ai: NimiScenarioJobClient;
};

export type RuntimeImageGenerateInput = {
  readonly runtime: RuntimeImageGenerateRuntime;
  readonly appId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly count?: number;
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly quality?: string;
  readonly style?: string;
  readonly seed?: string | number | bigint;
  readonly referenceImages?: readonly string[];
  readonly referenceImageArtifactId?: string;
  readonly mask?: string;
  readonly responseFormat?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Readonly<Record<string, string | undefined>>;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/**
 * Executes owner-driven image.generate through the Runtime Scenario job API.
 * The request carries App/capability input only; AIConfig route, local
 * configuration, model selection, and execution target remain Runtime-owned.
 */
export async function runRuntimeImageGenerate(
  input: RuntimeImageGenerateInput,
): Promise<RuntimeImageGenerateResult> {
  try {
    const identity = buildNimiRuntimeScenarioJobIdentity({
      appId: input.appId,
      capabilityId: 'image.generate',
      scenarioId: input.scenarioId,
    });
    const result = await runNimiRuntimeImageGeneration({
      runtime: { ai: input.runtime.ai },
      head: {
        appId: input.appId,
        ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {}),
      },
      prompt: input.prompt,
      ...(input.negativePrompt !== undefined ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.quality !== undefined ? { quality: input.quality } : {}),
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.referenceImages !== undefined ? { referenceImages: input.referenceImages } : {}),
      ...(input.referenceImageArtifactId !== undefined ? { referenceImageArtifactId: input.referenceImageArtifactId } : {}),
      ...(input.mask !== undefined ? { mask: input.mask } : {}),
      ...(input.responseFormat !== undefined ? { responseFormat: input.responseFormat } : {}),
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: imageScenarioLabels(input),
      ...(input.callOptions !== undefined ? { callOptions: input.callOptions } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.abortReason !== undefined ? { abortReason: input.abortReason } : {}),
      ...(input.onJobUpdate !== undefined ? { onJobUpdate: input.onJobUpdate } : {}),
    });
    const artifacts = result.artifacts.map(toImageArtifactSummary);
    const trace = imageGenerateTrace(result.job, result.traceId);
    return {
      ok: true,
      capabilityId: 'image.generate',
      message: artifacts.length === 1
        ? 'Runtime image.generate completed with 1 artifact.'
        : `Runtime image.generate completed with ${artifacts.length} artifacts.`,
      output: {
        kind: 'image-artifacts',
        jobId: result.job.jobId,
        jobStatus: imageJobStatusName(result.job.status),
        artifactCount: artifacts.length,
        ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
        artifacts,
      },
      ...(trace ? { trace } : {}),
    };
  } catch (cause) {
    const error = asNimiError(cause, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_image_execution',
      source: 'runtime',
    });
    return {
      ok: false,
      capabilityId: 'image.generate',
      reason: imageUnavailableReasonFromError(error),
      message: error.message,
      error,
    };
  }
}

function imageScenarioLabels(input: RuntimeImageGenerateInput): Record<string, string> {
  return Object.fromEntries(Object.entries({
    scenarioId: input.scenarioId,
    surfaceId: input.surfaceId,
    ...(input.metadata ?? {}),
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
}

function toImageArtifactSummary(
  artifact: NimiRuntimeScenarioArtifact,
): RuntimeImageGenerateArtifactSummary {
  const mimeType = normalizeText(artifact.mimeType) || 'image/png';
  const uri = normalizeText(artifact.uri);
  const artifactId = normalizeText(artifact.artifactId);
  const sizeBytes = imageArtifactSize(artifact);
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

function imageArtifactSize(artifact: NimiRuntimeScenarioArtifact): number {
  const declared = Number(normalizeText(artifact.sizeBytes));
  if (Number.isFinite(declared) && declared > 0) {
    return declared;
  }
  return artifact.bytes.length;
}

function imageGenerateTrace(
  job: ScenarioJob,
  traceId: string | undefined,
): RuntimeImageGenerateTrace | undefined {
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

function imageJobStatusName(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function imageUnavailableReasonFromError(error: NimiError): RuntimeImageGenerateUnavailableReason {
  const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
  if (reasonCode === ReasonCode.SDK_AI_INPUT_INVALID || reasonCode.startsWith('SDK_GENERATION_')) {
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
