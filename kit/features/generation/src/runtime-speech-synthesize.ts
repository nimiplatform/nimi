import {
  ScenarioJobStatus,
  createNimiRuntimeAISchedulingClient,
  listNimiRuntimeLocalAssetEntries,
  requireNimiRuntimeVoiceReferenceForLocalTts,
  resolveNimiAIConfigRuntimeBinding,
  runNimiRuntimeSpeechSynthesis,
  toNimiRuntimeVoiceReference,
  toNimiRuntimeVoiceReferenceFromInput,
  toRuntimeDurableTargetRef,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeLocalModelCenterRpc,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeSpeechSynthesisInput,
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
  readonly local?: NimiRuntimeLocalModelCenterRpc;
};

export type RuntimeSpeechSynthesizeScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeSpeechSynthesizeInput = {
  readonly runtime: RuntimeSpeechSynthesizeRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly binding?: NimiAIConfigRuntimeBinding;
  readonly text: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly onRuntimeRequest?: RuntimeRequestDiagnosticsRecorder;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
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

type RuntimeSpeechVoiceReferenceInput = Parameters<typeof toNimiRuntimeVoiceReference>[0];

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

  const resolved = input.binding
    ? { ok: true as const, binding: input.binding }
    : resolveNimiAIConfigRuntimeBinding({
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

  const bindingResult = await materializeSpeechBinding(input.runtime, resolved.binding);
  if (bindingResult.ok === false) {
    return unavailable('input-invalid', bindingResult.message);
  }
  const binding = bindingResult.binding;

  const scheduling = await ensureSchedulingPreflight(input, binding);
  if (scheduling.unavailable) {
    return scheduling.unavailable;
  }

  try {
    return await withRuntimeOperationTimeout({
      capabilityId: 'audio.synthesize',
      timeoutMs: params.timeoutMs,
      signal: input.signal,
      abortReason: input.abortReason,
      operation: (signal, abortReason) => withSpendMeterScope(
        { ...input, signal, abortReason },
        async (protectedOptions) => {
          const timedInput = { ...input, signal, abortReason };
          const callOptions: RuntimeTypedCallOptions = {
            metadata: {
              ...protectedOptions.metadata,
              ...buildMetadata(timedInput, binding, scheduling.metadata),
            },
            ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
          };
          const request = buildSpeechSynthesisInput({
            input: timedInput,
            binding,
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
              modelResolved: binding.model,
              routeDecision: binding.routePolicy,
            },
          };
        },
      ),
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
    signal: input.input.signal,
    abortReason: input.input.abortReason,
    onJobUpdate: input.input.onJobUpdate,
  };
}

function speechParamsFromBinding(binding: NimiAIConfigRuntimeBinding): SpeechParams {
  const params = paramRecord(binding.selectedParams);
  const voiceRef = voiceReferenceFromParams(binding, params);
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

async function materializeSpeechBinding(
  runtime: RuntimeSpeechSynthesizeRuntime,
  binding: NimiAIConfigRuntimeBinding,
): Promise<
  | { readonly ok: true; readonly binding: NimiAIConfigRuntimeBinding }
  | { readonly ok: false; readonly message: string }
> {
  if (binding.routePolicy !== 'local') {
    return { ok: true, binding };
  }
  if (!runtime.local) {
    return {
      ok: false,
      message: 'audio.synthesize local model binding requires Runtime local asset listing; reload Runtime projection and reselect the active model.',
    };
  }
  try {
    const assets = await listNimiRuntimeLocalAssetEntries({ local: runtime.local });
    const asset = findLocalAssetById(assets, binding.model);
    if (!asset) {
      return {
        ok: false,
        message: `audio.synthesize active model ${binding.model} is not present in Runtime local assets; reselect the active model.`,
      };
    }
    if (asset.kind !== 'tts') {
      return {
        ok: false,
        message: `audio.synthesize active model ${binding.model} resolves to local asset kind ${asset.kind}; expected tts.`,
      };
    }
    const model = requiredSemanticAssetId(asset, 'audio.synthesize');
    return {
      ok: true,
      binding: {
        ...binding,
        model,
        metadata: {
          ...binding.metadata,
          aiConfigRuntimeModelAssetId: model,
          aiConfigRuntimeModelLocalAssetId: asset.localAssetId,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: describeError(error),
    };
  }
}

function findLocalAssetById(
  assets: readonly NimiRuntimeLocalAssetEntry[],
  id: string,
): NimiRuntimeLocalAssetEntry | null {
  return assets.find((asset) => assetMatchesId(asset, id)) ?? null;
}

function assetMatchesId(asset: NimiRuntimeLocalAssetEntry, id: string): boolean {
  return localRuntimeRefCandidates(id).some((candidate) => (
    normalizeText(asset.localAssetId) === candidate
    || normalizeText(asset.assetId) === candidate
  ));
}

function localRuntimeRefCandidates(value: unknown): string[] {
  const text = normalizeText(value);
  if (!text) return [];
  const candidates = new Set<string>([text]);
  for (const prefix of ['local-runtime:', 'local/']) {
    if (text.toLowerCase().startsWith(prefix)) {
      const stripped = text.slice(prefix.length).trim();
      if (stripped) candidates.add(stripped);
    }
  }
  return [...candidates];
}

function requiredSemanticAssetId(asset: NimiRuntimeLocalAssetEntry, context: string): string {
  const assetId = normalizeText(asset.assetId);
  if (!assetId) {
    throw new Error(`${context} Runtime local asset ${asset.localAssetId} is missing semantic assetId; reload Runtime projection and re-import the asset.`);
  }
  return assetId;
}

function voiceReferenceFromParams(
  binding: NimiAIConfigRuntimeBinding,
  params: Record<string, unknown>,
): RuntimeSpeechVoiceReferenceInput {
  const raw = voiceReferenceInputFromParams(params);
  const providerVoiceRef = providerVoiceReferenceText(raw)
    || optionalDefaultText(params.providerVoiceRef ?? params.provider_voice_ref);
  if (binding.routePolicy !== 'local' && providerVoiceRef) {
    return {
      kind: 'provider_voice_ref',
      providerVoiceRef,
    };
  }
  return requireNimiRuntimeVoiceReferenceForLocalTts({
    routePolicy: binding.routePolicy,
    voiceRef: toNimiRuntimeVoiceReferenceFromInput(raw),
  });
}

function providerVoiceReferenceText(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Readonly<Record<string, unknown>>;
    const kind = optionalDefaultText(record.kind)?.toLowerCase();
    if (kind === 'provider_voice_ref') {
      return optionalDefaultText(record.providerVoiceRef ?? record.provider_voice_ref);
    }
    return optionalDefaultText(record.providerVoiceRef ?? record.provider_voice_ref);
  }
  const text = optionalDefaultText(input);
  if (!text) return undefined;
  const [rawPrefix, ...rest] = text.split(':');
  if (optionalDefaultText(rawPrefix)?.toLowerCase() !== 'provider_voice_ref') {
    return undefined;
  }
  return optionalDefaultText(rest.join(':'));
}

function voiceReferenceInputFromParams(params: Record<string, unknown>): unknown {
  if (params.voiceRef !== undefined) return params.voiceRef;
  if (params.voice_ref !== undefined) return params.voice_ref;
  if (params.providerVoiceRef !== undefined) return { providerVoiceRef: params.providerVoiceRef };
  if (params.provider_voice_ref !== undefined) return { provider_voice_ref: params.provider_voice_ref };
  if (params.presetVoiceId !== undefined) return { presetVoiceId: params.presetVoiceId };
  if (params.preset_voice_id !== undefined) return { preset_voice_id: params.preset_voice_id };
  if (params.voiceAssetId !== undefined) return { voiceAssetId: params.voiceAssetId };
  if (params.voice_asset_id !== undefined) return { voice_asset_id: params.voice_asset_id };
  return params;
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
    ...binding.metadata,
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
  return unavailable(runtimeUnavailableReasonFromError(error), describeError(error));
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
  return describeRuntimeGenerationError(error, 'Runtime speech synthesis failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
