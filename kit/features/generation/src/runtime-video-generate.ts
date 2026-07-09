import {
  ScenarioJobStatus,
  coerceNimiVideoGenerationParams,
  createNimiRuntimeAISchedulingClient,
  resolveNimiAIConfigRuntimeBinding,
  runNimiRuntimeVideoGeneration,
  toRuntimeDurableTargetRef,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeVideoGenerationInput,
  type NimiVideoGenerationCoercedParams,
  type RuntimeTypedCallOptions,
  type ScenarioArtifact,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  describeRuntimeGenerationError,
  runtimeUnavailableReasonFromError,
  withRuntimeRequestDiagnostics,
  type RuntimeRequestDiagnosticsRecorder,
} from './runtime-diagnostics.js';
import { withRuntimeOperationTimeout } from './runtime-operation-timeout.js';

export type RuntimeVideoGenerateUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
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
};

export type RuntimeVideoGenerateResult = RuntimeVideoGenerateSuccess | RuntimeVideoGenerateUnavailable;

export type RuntimeVideoGenerateRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeVideoGenerateScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeVideoGenerateInput = {
  readonly runtime: RuntimeVideoGenerateRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly binding?: NimiAIConfigRuntimeBinding;
  readonly prompt: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly onRuntimeRequest?: RuntimeRequestDiagnosticsRecorder;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly withScopes?: RuntimeVideoGenerateScopeRunner;
};

type SchedulingPreflight = {
  readonly unavailable: RuntimeVideoGenerateUnavailable | null;
  readonly metadata: Record<string, string>;
};

export async function runRuntimeVideoGenerate(
  input: RuntimeVideoGenerateInput,
): Promise<RuntimeVideoGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailable('input-invalid', 'Video prompt is required before dispatch.');
  }

  const resolved = input.binding
    ? { ok: true as const, binding: input.binding }
    : resolveNimiAIConfigRuntimeBinding({
      config: input.config,
      capabilityId: 'video.generate',
      bindingCapabilityId: 'video.generate',
    });
  if (resolved.ok === false) {
    return unavailable('ai-config-binding-missing', resolved.message);
  }

  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable('principal-unauthorized', 'Runtime account subjectUserId is required before video dispatch.');
  }

  let params: NimiVideoGenerationCoercedParams;
  try {
    params = coerceNimiVideoGenerationParams(paramRecord(resolved.binding.selectedParams));
  } catch (error) {
    return unavailable('input-invalid', describeError(error));
  }

  const scheduling = await ensureSchedulingPreflight(input, resolved.binding);
  if (scheduling.unavailable) return scheduling.unavailable;

  try {
    return await withRuntimeOperationTimeout({
      capabilityId: 'video.generate',
      timeoutMs: params.timeoutMs,
      signal: input.signal,
      abortReason: input.abortReason,
      operation: (signal, abortReason) => withSpendMeterScope({ ...input, signal, abortReason }, async (protectedOptions) => {
        const timedInput = { ...input, signal, abortReason };
        const callOptions: RuntimeTypedCallOptions = {
          metadata: {
            ...protectedOptions.metadata,
            ...buildMetadata(timedInput, resolved.binding, scheduling.metadata),
          },
          ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        };
        const generated = await runNimiRuntimeVideoGeneration(buildVideoGenerationInput({
          input: timedInput,
          binding: resolved.binding,
          params,
          prompt,
          subjectUserId,
          callOptions,
        }));
        const artifacts = generated.artifacts.map(summarizeVideoArtifact);
        const firstArtifact = artifacts[0];
        return {
          ok: true,
          capabilityId: 'video.generate',
          message: `Runtime completed video job ${generated.job.jobId} with ${artifacts.length} video artifact(s).`,
          output: {
            kind: 'video-artifacts',
            jobId: generated.job.jobId,
            jobStatus: scenarioJobStatusText(generated.job.status),
            artifactCount: artifacts.length,
            ...(firstArtifact ? { firstArtifact } : {}),
            artifacts,
          },
          trace: {
            traceId: generated.traceId || generated.job.traceId || undefined,
            modelResolved: resolved.binding.model,
            routeDecision: resolved.binding.routePolicy,
          },
        };
      }),
    });
  } catch (error) {
    return unavailableFromError(error);
  }
}

function buildVideoGenerationInput(input: {
  readonly input: RuntimeVideoGenerateInput;
  readonly binding: NimiAIConfigRuntimeBinding;
  readonly params: NimiVideoGenerationCoercedParams;
  readonly prompt: string;
  readonly subjectUserId: string;
  readonly callOptions: RuntimeTypedCallOptions;
}): NimiRuntimeVideoGenerationInput {
  return {
    runtime: { ai: withRuntimeRequestDiagnostics(input.input.runtime.ai, input.input.onRuntimeRequest) },
    head: {
      appId: input.input.appId,
      subjectUserId: input.subjectUserId,
      modelId: input.binding.model,
      routePolicy: input.binding.routePolicy,
      connectorId: input.binding.connectorId,
      targetRef: toRuntimeDurableTargetRef(input.binding.targetRef),
      timeoutMs: input.params.timeoutMs,
    },
    mode: input.params.mode,
    prompt: input.prompt,
    negativePrompt: input.params.negativePrompt,
    content: [{ type: 'text', role: 'prompt', text: input.prompt }],
    options: input.params.options,
    requestId: input.input.scenarioId,
    idempotencyKey: input.input.scenarioId,
    labels: buildLabels(input.input, input.binding),
    callOptions: input.callOptions,
    signal: input.input.signal,
    abortReason: input.input.abortReason,
    onJobUpdate: input.input.onJobUpdate,
  };
}

function summarizeVideoArtifact(artifact: ScenarioArtifact): RuntimeVideoGenerateArtifactSummary {
  const artifactId = normalizeText(artifact.artifactId);
  const mimeType = normalizeText(artifact.mimeType) || 'video/mp4';
  const uri = normalizeText(artifact.uri);
  const bytes = byteArray(artifact.bytes);
  if (uri) {
    return artifactSummary(artifact, {
      artifactId,
      mimeType,
      uri,
      previewUrl: uri,
      previewSource: 'hosted-uri',
    });
  }
  if (bytes.byteLength > 0) {
    return artifactSummary(artifact, {
      artifactId,
      mimeType,
      previewUrl: dataUrl(mimeType, bytes),
      previewSource: 'inline-bytes',
    });
  }
  return artifactSummary(artifact, {
    artifactId,
    mimeType,
    previewSource: 'metadata-only',
  });
}

function artifactSummary(
  artifact: ScenarioArtifact,
  base: {
    readonly artifactId?: string;
    readonly mimeType: string;
    readonly uri?: string;
    readonly previewUrl?: string;
    readonly previewSource: RuntimeVideoGenerateArtifactSummary['previewSource'];
  },
): RuntimeVideoGenerateArtifactSummary {
  const sizeBytes = integerOrUndefined(artifact.sizeBytes);
  return {
    ...(base.artifactId ? { artifactId: base.artifactId } : {}),
    mimeType: base.mimeType,
    ...(base.uri ? { uri: base.uri } : {}),
    ...(base.previewUrl ? { previewUrl: base.previewUrl } : {}),
    previewSource: base.previewSource,
    ...(sizeBytes ? { sizeBytes } : {}),
    ...(artifact.width > 0 ? { width: artifact.width } : {}),
    ...(artifact.height > 0 ? { height: artifact.height } : {}),
  };
}

async function ensureSchedulingPreflight(
  input: RuntimeVideoGenerateInput,
  binding: NimiAIConfigRuntimeBinding,
): Promise<SchedulingPreflight> {
  if (!binding.schedulingTarget) {
    return { unavailable: null, metadata: {} };
  }
  try {
    const scheduling = createNimiRuntimeAISchedulingClient({
      runtime: input.runtime,
      appId: input.appId,
      targets: [binding.schedulingTarget],
    });
    const batch = await scheduling.peek();
    if (batch.aggregateJudgement?.state === 'denied') {
      return {
        unavailable: unavailable(
          'runtime-call-failed',
          `Runtime scheduling denied video.generate: ${batch.aggregateJudgement.detail || 'denied'}`,
        ),
        metadata: schedulingMetadata(batch),
      };
    }
    return { unavailable: null, metadata: schedulingMetadata(batch) };
  } catch (error) {
    return { unavailable: unavailableFromError(error), metadata: {} };
  }
}

function schedulingMetadata(batch: {
  readonly aggregateJudgement?: {
    readonly state: string;
    readonly detail?: string | null;
    readonly resourceWarnings?: readonly string[];
  } | null;
}): Record<string, string> {
  const judgement = batch.aggregateJudgement;
  if (!judgement) return {};
  return {
    runtimeSchedulingState: judgement.state,
    ...(judgement.detail ? { runtimeSchedulingDetail: judgement.detail } : {}),
    ...(judgement.resourceWarnings && judgement.resourceWarnings.length > 0
      ? { runtimeSchedulingWarnings: judgement.resourceWarnings.join(',') }
      : {}),
  };
}

function buildMetadata(
  input: RuntimeVideoGenerateInput,
  binding: NimiAIConfigRuntimeBinding,
  scheduling: Record<string, string>,
): Record<string, string> {
  return {
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    ...binding.metadata,
    ...scheduling,
    ...stringMetadata(input.metadata),
  };
}

function buildLabels(
  input: RuntimeVideoGenerateInput,
  binding: NimiAIConfigRuntimeBinding,
): Record<string, string> {
  return {
    appId: input.appId,
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    capabilityId: 'video.generate',
    bindingCapabilityId: binding.bindingCapabilityId,
    routePolicy: binding.routePolicy,
    targetRefKind: binding.targetRef.kind,
    ...binding.metadata,
    ...stringMetadata(input.metadata),
  };
}

function withSpendMeterScope<T>(
  input: RuntimeVideoGenerateInput,
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
): Promise<T> {
  if (!input.withScopes) return operation({});
  return input.withScopes(['ai.spend.meter'], operation);
}

function paramRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringMetadata(metadata: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (normalizedKey && normalizedValue) {
      out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${base64FromBytes(bytes)}`;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

function byteArray(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) {
    return new Uint8Array(value.filter((item) => Number.isInteger(item) && item >= 0 && item <= 255));
  }
  return new Uint8Array();
}

function integerOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(normalizeText(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function scenarioJobStatusText(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function unavailableFromError(error: unknown): RuntimeVideoGenerateUnavailable {
  return unavailable(runtimeUnavailableReasonFromError(error), describeError(error));
}

function unavailable(
  reason: RuntimeVideoGenerateUnavailableReason,
  message: string,
): RuntimeVideoGenerateUnavailable {
  return {
    ok: false,
    capabilityId: 'video.generate',
    reason,
    message,
  };
}

function describeError(error: unknown): string {
  return describeRuntimeGenerationError(error, 'Runtime video generation failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
