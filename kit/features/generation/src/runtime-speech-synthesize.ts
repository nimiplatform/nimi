import {
  ScenarioJobStatus,
  createNimiRuntimeAISchedulingClient,
  requireNimiRuntimeVoiceReferenceForLocalTts,
  resolveNimiAIConfigRuntimeBinding,
  runNimiRuntimeSpeechSynthesis,
  toNimiRuntimeVoiceReference,
  toNimiRuntimeVoiceReferenceFromInput,
  toRuntimeDurableTargetRef,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiJsonObject,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeSpeechSynthesisInput,
  type RuntimeTypedCallOptions,
  type ScenarioArtifact,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeSpeechSynthesizeUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

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
};

export type RuntimeSpeechSynthesizeResult =
  | RuntimeSpeechSynthesizeSuccess
  | RuntimeSpeechSynthesizeUnavailable;

export type RuntimeSpeechSynthesizeRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeSpeechSynthesizeScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeSpeechSynthesizeInput = {
  readonly runtime: RuntimeSpeechSynthesizeRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly text: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly withScopes?: RuntimeSpeechSynthesizeScopeRunner;
};

type SpeechParams = {
  readonly voiceRef?: NimiRuntimeSpeechSynthesisInput['voiceRef'];
  readonly language?: string;
  readonly audioFormat?: string;
  readonly sampleRateHz?: number;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly emotion?: string;
  readonly timeoutMs?: number;
};

type SchedulingPreflight = {
  readonly unavailable: RuntimeSpeechSynthesizeUnavailable | null;
  readonly metadata: Record<string, string>;
};

export async function runRuntimeSpeechSynthesize(
  input: RuntimeSpeechSynthesizeInput,
): Promise<RuntimeSpeechSynthesizeResult> {
  const text = input.text.trim();
  if (!text) {
    return unavailable('input-invalid', 'Speech synthesis text is required before dispatch.');
  }

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config: input.config,
    capabilityId: 'audio.synthesize',
    bindingCapabilityId: 'audio.synthesize',
  });
  if (resolved.ok === false) {
    return unavailable('ai-config-binding-missing', resolved.message);
  }

  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable('principal-unauthorized', 'Runtime account subjectUserId is required before speech synthesis.');
  }

  let params: SpeechParams;
  try {
    params = speechParamsFromBinding(resolved.binding);
  } catch (error) {
    return unavailable('input-invalid', describeError(error));
  }

  const scheduling = await ensureSchedulingPreflight(input, resolved.binding);
  if (scheduling.unavailable) {
    return scheduling.unavailable;
  }

  try {
    return await withSpendMeterScope(input, async (protectedOptions) => {
      const callOptions: RuntimeTypedCallOptions = {
        metadata: {
          ...protectedOptions.metadata,
          ...buildMetadata(input, resolved.binding, scheduling.metadata),
        },
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      };
      const request = buildSpeechSynthesisInput({
        input,
        binding: resolved.binding,
        params,
        subjectUserId,
        text,
        callOptions,
      });
      const generated = await runNimiRuntimeSpeechSynthesis(request);
      const artifacts = generated.artifacts.map(summarizeAudioArtifact);
      const firstArtifact = artifacts[0];
      return {
        ok: true,
        capabilityId: 'audio.synthesize',
        message: `Runtime completed speech synthesis job ${generated.job.jobId} with ${artifacts.length} audio artifact(s).`,
        output: {
          kind: 'audio-artifacts',
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
    });
  } catch (error) {
    return unavailableFromError(error);
  }
}

function buildSpeechSynthesisInput(input: {
  readonly input: RuntimeSpeechSynthesizeInput;
  readonly binding: NimiAIConfigRuntimeBinding;
  readonly params: SpeechParams;
  readonly subjectUserId: string;
  readonly text: string;
  readonly callOptions: RuntimeTypedCallOptions;
}): NimiRuntimeSpeechSynthesisInput {
  return {
    runtime: { ai: input.input.runtime.ai },
    head: {
      appId: input.input.appId,
      subjectUserId: input.subjectUserId,
      modelId: input.binding.model,
      routePolicy: input.binding.routePolicy,
      connectorId: input.binding.connectorId,
      targetRef: toRuntimeDurableTargetRef(input.binding.targetRef),
      timeoutMs: input.params.timeoutMs,
    },
    text: input.text,
    voiceRef: input.params.voiceRef,
    language: input.params.language,
    audioFormat: input.params.audioFormat,
    sampleRateHz: input.params.sampleRateHz,
    speed: input.params.speed,
    pitch: input.params.pitch,
    volume: input.params.volume,
    emotion: input.params.emotion,
    requestId: input.input.scenarioId,
    idempotencyKey: input.input.scenarioId,
    labels: buildLabels(input.input, input.binding),
    callOptions: input.callOptions,
    onJobUpdate: input.input.onJobUpdate,
  };
}

function speechParamsFromBinding(binding: NimiAIConfigRuntimeBinding): SpeechParams {
  const params = paramRecord(binding.selectedParams);
  const voiceRef = requireNimiRuntimeVoiceReferenceForLocalTts({
    routePolicy: binding.routePolicy,
    voiceRef: toNimiRuntimeVoiceReferenceFromInput(
      params.voiceRef
      ?? params.voice_ref
      ?? params.providerVoiceRef
      ?? params.provider_voice_ref
      ?? params.presetVoiceId
      ?? params.preset_voice_id
      ?? params.voiceAssetId
      ?? params.voice_asset_id,
    ),
  });
  return {
    voiceRef: toNimiRuntimeVoiceReference(voiceRef),
    language: optionalDefaultText(params.languageHint ?? params.language_hint ?? params.language),
    audioFormat: optionalDefaultText(params.responseFormat ?? params.response_format ?? params.audioFormat ?? params.audio_format) ?? 'mp3',
    sampleRateHz: optionalPositiveInteger(params.sampleRateHz ?? params.sample_rate_hz, 'sampleRateHz'),
    speed: optionalFiniteNumber(params.speakingRate ?? params.speaking_rate ?? params.speed, 'speakingRate'),
    pitch: optionalFiniteNumber(params.pitchSemitones ?? params.pitch_semitones ?? params.pitch, 'pitchSemitones'),
    volume: optionalFiniteNumber(params.volume, 'volume'),
    emotion: optionalDefaultText(params.emotion),
    timeoutMs: optionalPositiveInteger(params.timeoutMs ?? params.timeout_ms, 'timeoutMs'),
  };
}

function summarizeAudioArtifact(artifact: ScenarioArtifact): RuntimeSpeechSynthesizeArtifactSummary {
  const artifactId = normalizeText(artifact.artifactId);
  const mimeType = normalizeText(artifact.mimeType) || 'audio/mpeg';
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
    readonly previewSource: RuntimeSpeechSynthesizeArtifactSummary['previewSource'];
  },
): RuntimeSpeechSynthesizeArtifactSummary {
  const sizeBytes = integerOrUndefined(artifact.sizeBytes);
  return {
    ...(base.artifactId ? { artifactId: base.artifactId } : {}),
    mimeType: base.mimeType,
    ...(base.uri ? { uri: base.uri } : {}),
    ...(base.previewUrl ? { previewUrl: base.previewUrl } : {}),
    previewSource: base.previewSource,
    ...(sizeBytes ? { sizeBytes } : {}),
  };
}

async function ensureSchedulingPreflight(
  input: RuntimeSpeechSynthesizeInput,
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
          `Runtime scheduling denied audio.synthesize: ${batch.aggregateJudgement.detail || 'denied'}`,
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
  input: RuntimeSpeechSynthesizeInput,
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
  input: RuntimeSpeechSynthesizeInput,
  binding: NimiAIConfigRuntimeBinding,
): Record<string, string> {
  return {
    appId: input.appId,
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    capabilityId: 'audio.synthesize',
    bindingCapabilityId: binding.bindingCapabilityId,
    routePolicy: binding.routePolicy,
    targetRefKind: binding.targetRef.kind,
    ...stringMetadata(input.metadata),
  };
}

function withSpendMeterScope<T>(
  input: RuntimeSpeechSynthesizeInput,
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
): Promise<T> {
  if (!input.withScopes) {
    return operation({});
  }
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

function optionalDefaultText(value: unknown): string | undefined {
  const raw = typeof value === 'number' || typeof value === 'bigint' ? String(value) : normalizeText(value);
  const lower = raw.toLowerCase();
  return raw && lower !== 'default' && lower !== 'auto' ? raw : undefined;
}

function optionalFiniteNumber(value: unknown, fieldName: string): number | undefined {
  const raw = typeof value === 'number' ? String(value) : normalizeText(value);
  if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'auto') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`audio.synthesize selectedParams.${fieldName} must be a finite number.`);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = optionalFiniteNumber(value, fieldName);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`audio.synthesize selectedParams.${fieldName} must be a positive integer.`);
  }
  return parsed;
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
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
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

function unavailableFromError(error: unknown): RuntimeSpeechSynthesizeUnavailable {
  const reasonCode = error && typeof error === 'object'
    ? String(
      (error as { reasonCode?: unknown }).reasonCode
      || (error as { code?: unknown }).code
      || '',
    )
    : '';
  const reason: RuntimeSpeechSynthesizeUnavailableReason = reasonCode === 'SDK_RUNTIME_METHOD_UNAVAILABLE'
    ? 'sdk-method-unavailable'
    : reasonCode === 'AUTH_CONTEXT_MISSING'
      || reasonCode === 'PRINCIPAL_UNAUTHORIZED'
      || reasonCode === 'SESSION_EXPIRED'
      || reasonCode === 'APP_TOKEN_EXPIRED'
      || reasonCode === 'APP_TOKEN_REVOKED'
        ? 'principal-unauthorized'
        : 'runtime-call-failed';
  return unavailable(reason, describeError(error));
}

function unavailable(
  reason: RuntimeSpeechSynthesizeUnavailableReason,
  message: string,
): RuntimeSpeechSynthesizeUnavailable {
  return {
    ok: false,
    capabilityId: 'audio.synthesize',
    reason,
    message,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    const code = reasonCode || (error.name && error.name !== 'Error' ? error.name : '');
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error || 'Runtime speech synthesis failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
