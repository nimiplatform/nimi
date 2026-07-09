import {
  ScenarioJobStatus,
  audioBytesFromNimiUrl,
  coerceNimiSpeechTranscriptionParams,
  createNimiRuntimeAISchedulingClient,
  resolveNimiAIConfigRuntimeBinding,
  runNimiRuntimeSpeechTranscription,
  toRuntimeDurableTargetRef,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeSpeechTranscriptionInput,
  type NimiRuntimeSpeechTranscriptionAudioSource,
  type NimiSpeechTranscriptionCoercedParams,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  describeRuntimeGenerationError,
  runtimeUnavailableReasonFromError,
  withRuntimeRequestDiagnostics,
  type RuntimeRequestDiagnosticsRecorder,
} from './runtime-diagnostics.js';
import { withRuntimeOperationTimeout } from './runtime-operation-timeout.js';

export type RuntimeSpeechTranscribeUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
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
};

export type RuntimeSpeechTranscribeResult =
  | RuntimeSpeechTranscribeSuccess
  | RuntimeSpeechTranscribeUnavailable;

export type RuntimeSpeechTranscribeRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeSpeechTranscribeScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeSpeechTranscribeInput = {
  readonly runtime: RuntimeSpeechTranscribeRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly binding?: NimiAIConfigRuntimeBinding;
  readonly audio?: RuntimeSpeechTranscribeAudioInput;
  readonly audioUrl?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly onRuntimeRequest?: RuntimeRequestDiagnosticsRecorder;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly withScopes?: RuntimeSpeechTranscribeScopeRunner;
};

type SchedulingPreflight = {
  readonly unavailable: RuntimeSpeechTranscribeUnavailable | null;
  readonly metadata: Record<string, string>;
};

export async function runRuntimeSpeechTranscribe(
  input: RuntimeSpeechTranscribeInput,
): Promise<RuntimeSpeechTranscribeResult> {
  const resolved = input.binding
    ? { ok: true as const, binding: input.binding }
    : resolveNimiAIConfigRuntimeBinding({
      config: input.config,
      capabilityId: 'audio.transcribe',
      bindingCapabilityId: 'audio.transcribe',
    });
  if (resolved.ok === false) {
    return unavailable('ai-config-binding-missing', resolved.message);
  }

  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable('principal-unauthorized', 'Runtime account subjectUserId is required before speech transcription.');
  }

  let params: NimiSpeechTranscriptionCoercedParams;
  try {
    params = coerceNimiSpeechTranscriptionParams(paramRecord(resolved.binding.selectedParams));
  } catch (error) {
    return unavailable('input-invalid', describeError(error));
  }

  const scheduling = await ensureSchedulingPreflight(input, resolved.binding);
  if (scheduling.unavailable) return scheduling.unavailable;

  const resolvedAudio = await resolveAudioInput(input);
  if (resolvedAudio.ok === false) return resolvedAudio.unavailable;

  try {
    return await withRuntimeOperationTimeout({
      capabilityId: 'audio.transcribe',
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
        const generated = await runNimiRuntimeSpeechTranscription(buildSpeechTranscriptionInput({
          input: timedInput,
          binding: resolved.binding,
          params,
          audio: resolvedAudio.audio,
          subjectUserId,
          callOptions,
        }));
        return {
          ok: true,
          capabilityId: 'audio.transcribe',
          message: `Runtime returned transcript (${generated.text.length} chars, jobState=${scenarioJobStatusText(generated.job.status)}).`,
          output: {
            kind: 'transcript',
            text: generated.text,
            jobId: generated.job.jobId,
            jobStatus: scenarioJobStatusText(generated.job.status),
            artifactCount: generated.artifacts.length,
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

async function resolveAudioInput(input: RuntimeSpeechTranscribeInput): Promise<
  | { readonly ok: true; readonly audio: { readonly source: NimiRuntimeSpeechTranscriptionAudioSource; readonly mimeType: string } }
  | { readonly ok: false; readonly unavailable: RuntimeSpeechTranscribeUnavailable }
> {
  if (input.audio) {
    if (input.audio.type === 'bytes') {
      if (input.audio.bytes.byteLength === 0) {
        return { ok: false, unavailable: unavailable('input-invalid', 'audio.transcribe requires non-empty audio bytes.') };
      }
      return { ok: true, audio: { source: { type: 'bytes', bytes: input.audio.bytes }, mimeType: input.audio.mimeType } };
    }
    if (input.audio.type === 'chunks') {
      const chunks = input.audio.chunks.filter((chunk) => chunk.byteLength > 0);
      if (chunks.length === 0) {
        return { ok: false, unavailable: unavailable('input-invalid', 'audio.transcribe requires at least one non-empty audio chunk.') };
      }
      return { ok: true, audio: { source: { type: 'chunks', chunks }, mimeType: input.audio.mimeType } };
    }
    return { ok: true, audio: { source: { type: 'url', url: input.audio.url }, mimeType: input.audio.mimeType || 'audio/wav' } };
  }
  const url = normalizeText(input.audioUrl);
  if (!url) {
    return { ok: false, unavailable: unavailable('input-invalid', 'audio.transcribe requires an audio input or audioUrl.') };
  }
  try {
    const loaded = await audioBytesFromNimiUrl(url);
    return { ok: true, audio: { source: { type: 'bytes', bytes: loaded.bytes }, mimeType: loaded.mimeType } };
  } catch (error) {
    return { ok: false, unavailable: unavailable('input-invalid', describeError(error)) };
  }
}

function buildSpeechTranscriptionInput(input: {
  readonly input: RuntimeSpeechTranscribeInput;
  readonly binding: NimiAIConfigRuntimeBinding;
  readonly params: NimiSpeechTranscriptionCoercedParams;
  readonly audio: { readonly source: NimiRuntimeSpeechTranscriptionAudioSource; readonly mimeType: string };
  readonly subjectUserId: string;
  readonly callOptions: RuntimeTypedCallOptions;
}): NimiRuntimeSpeechTranscriptionInput {
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
    audio: input.audio.source,
    mimeType: input.audio.mimeType,
    language: input.params.language,
    responseFormat: input.params.responseFormat,
    speakerCount: input.params.speakerCount,
    prompt: input.params.prompt,
    timestamps: input.params.timestamps,
    diarization: input.params.diarization,
    requestId: input.input.scenarioId,
    idempotencyKey: input.input.scenarioId,
    labels: buildLabels(input.input, input.binding),
    callOptions: input.callOptions,
    signal: input.input.signal,
    abortReason: input.input.abortReason,
    onJobUpdate: input.input.onJobUpdate,
  };
}

async function ensureSchedulingPreflight(
  input: RuntimeSpeechTranscribeInput,
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
          `Runtime scheduling denied audio.transcribe: ${batch.aggregateJudgement.detail || 'denied'}`,
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
  input: RuntimeSpeechTranscribeInput,
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
  input: RuntimeSpeechTranscribeInput,
  binding: NimiAIConfigRuntimeBinding,
): Record<string, string> {
  return {
    appId: input.appId,
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    capabilityId: 'audio.transcribe',
    bindingCapabilityId: binding.bindingCapabilityId,
    routePolicy: binding.routePolicy,
    targetRefKind: binding.targetRef.kind,
    ...binding.metadata,
    ...stringMetadata(input.metadata),
  };
}

function withSpendMeterScope<T>(
  input: RuntimeSpeechTranscribeInput,
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

function scenarioJobStatusText(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function unavailableFromError(error: unknown): RuntimeSpeechTranscribeUnavailable {
  return unavailable(runtimeUnavailableReasonFromError(error), describeError(error));
}

function unavailable(
  reason: RuntimeSpeechTranscribeUnavailableReason,
  message: string,
): RuntimeSpeechTranscribeUnavailable {
  return {
    ok: false,
    capabilityId: 'audio.transcribe',
    reason,
    message,
  };
}

function describeError(error: unknown): string {
  return describeRuntimeGenerationError(error, 'Runtime speech transcription failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
