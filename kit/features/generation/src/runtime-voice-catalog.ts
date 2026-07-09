import {
  createNimiRuntimeAISchedulingClient,
  resolveNimiAIConfigRuntimeBinding,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiRuntimeAISchedulingClient,
  type RuntimeTypedCallOptions,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  describeRuntimeGenerationError,
  runtimeUnavailableReasonFromError,
  withRuntimeRequestDiagnostics,
  type RuntimeRequestDiagnosticsRecorder,
} from './runtime-diagnostics.js';

export type RuntimeVoiceCatalogUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeVoiceCatalogOutput = {
  readonly kind: 'voice-catalog';
  readonly modelResolved: string;
  readonly voiceCount: number;
  readonly sample: readonly { readonly voiceId: string; readonly name: string; readonly lang: string }[];
};

export type RuntimeVoiceCatalogSuccess = {
  readonly ok: true;
  readonly capabilityId: 'speech.bundle';
  readonly message: string;
  readonly output: RuntimeVoiceCatalogOutput;
  readonly trace?: {
    readonly traceId?: string;
    readonly modelResolved?: string;
    readonly routeDecision?: string;
  };
};

export type RuntimeVoiceCatalogUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'speech.bundle';
  readonly reason: RuntimeVoiceCatalogUnavailableReason;
  readonly message: string;
};

export type RuntimeVoiceCatalogResult = RuntimeVoiceCatalogSuccess | RuntimeVoiceCatalogUnavailable;

type RuntimeVoiceCatalogListRequest = {
  readonly appId: string;
  readonly subjectUserId: string;
  readonly modelId: string;
  readonly targetModelId: string;
  readonly connectorId: string;
};

type RuntimeVoiceCatalogVoice = {
  readonly voiceId?: string;
  readonly name?: string;
  readonly lang?: string;
};

type RuntimeVoiceCatalogListResponse = {
  readonly voices?: readonly RuntimeVoiceCatalogVoice[];
  readonly modelResolved?: string;
  readonly traceId?: string;
};

export type RuntimeVoiceCatalogRuntime = {
  readonly ai: {
    readonly listPresetVoices?: (
      request: RuntimeVoiceCatalogListRequest,
      options?: RuntimeTypedCallOptions,
    ) => Promise<RuntimeVoiceCatalogListResponse>;
  };
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeVoiceCatalogScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeVoiceCatalogInput = {
  readonly runtime: RuntimeVoiceCatalogRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly binding?: NimiAIConfigRuntimeBinding;
  readonly bindingCapabilityId?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onRuntimeRequest?: RuntimeRequestDiagnosticsRecorder;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly withScopes?: RuntimeVoiceCatalogScopeRunner;
};

type SchedulingPreflight = {
  readonly unavailable: RuntimeVoiceCatalogUnavailable | null;
  readonly metadata: Record<string, string>;
};

export async function runRuntimeVoiceCatalog(
  input: RuntimeVoiceCatalogInput,
): Promise<RuntimeVoiceCatalogResult> {
  const resolved = input.binding
    ? { ok: true as const, binding: input.binding }
    : resolveNimiAIConfigRuntimeBinding({
      config: input.config,
      capabilityId: 'audio.synthesize',
      bindingCapabilityId: input.bindingCapabilityId ?? 'audio.synthesize',
    });
  if (resolved.ok === false) {
    return unavailable('ai-config-binding-missing', resolved.message);
  }

  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable('principal-unauthorized', 'Runtime account subjectUserId is required before voice catalog lookup.');
  }

  const listPresetVoices = withRuntimeRequestDiagnostics(input.runtime.ai, input.onRuntimeRequest).listPresetVoices;
  if (!listPresetVoices) {
    return unavailable('sdk-method-unavailable', 'Runtime AI listPresetVoices SDK surface is unavailable.');
  }

  const scheduling = await ensureSchedulingPreflight(input, resolved.binding);
  if (scheduling.unavailable) return scheduling.unavailable;

  try {
    return await withSpendMeterScope(input, async (protectedOptions) => {
      const callOptions: RuntimeTypedCallOptions = {
        metadata: {
          ...protectedOptions.metadata,
          ...buildMetadata(input, resolved.binding, scheduling.metadata),
        },
        signal: input.signal,
      };
      const output = await listPresetVoices({
        appId: input.appId,
        subjectUserId,
        modelId: resolved.binding.model,
        targetModelId: resolved.binding.model,
        connectorId: resolved.binding.connectorId ?? '',
      }, callOptions);
      const voices = output.voices ?? [];
      return {
        ok: true,
        capabilityId: 'speech.bundle',
        message: `Runtime returned ${voices.length} preset voice(s).`,
        output: {
          kind: 'voice-catalog',
          modelResolved: output.modelResolved || resolved.binding.model || 'unresolved',
          voiceCount: voices.length,
          sample: voices.slice(0, 4).map((voice) => ({
            voiceId: voice.voiceId ?? '',
            name: voice.name ?? '',
            lang: voice.lang ?? '',
          })),
        },
        trace: {
          traceId: output.traceId || undefined,
          modelResolved: output.modelResolved || resolved.binding.model || undefined,
          routeDecision: resolved.binding.routePolicy,
        },
      };
    });
  } catch (error) {
    return unavailableFromError(error);
  }
}

function withSpendMeterScope<T>(
  input: RuntimeVoiceCatalogInput,
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
): Promise<T> {
  if (!input.withScopes) return operation({});
  return input.withScopes(['ai.spend.meter'], operation);
}

async function ensureSchedulingPreflight(
  input: RuntimeVoiceCatalogInput,
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
          `Runtime scheduling denied speech.bundle: ${batch.aggregateJudgement.detail || 'denied'}`,
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
  input: RuntimeVoiceCatalogInput,
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

function unavailableFromError(error: unknown): RuntimeVoiceCatalogUnavailable {
  return unavailable(runtimeUnavailableReasonFromError(error), describeError(error));
}

function unavailable(
  reason: RuntimeVoiceCatalogUnavailableReason,
  message: string,
): RuntimeVoiceCatalogUnavailable {
  return {
    ok: false,
    capabilityId: 'speech.bundle',
    reason,
    message,
  };
}

function describeError(error: unknown): string {
  return describeRuntimeGenerationError(error, 'Runtime voice catalog lookup failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
