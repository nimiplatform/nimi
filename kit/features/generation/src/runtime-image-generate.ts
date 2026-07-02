import {
  ScenarioJobStatus,
  coerceNimiImageGenerationParams,
  createNimiRuntimeAISchedulingClient,
  resolveNimiAIConfigRuntimeBinding,
  resolveNimiRuntimeImageCompanionSlots,
  runNimiRuntimeImageGeneration,
  toNimiRuntimeProtoStruct,
  toRuntimeDurableTargetRef,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiImageGenerationCoercedParams,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeImageGenerationInput,
  type NimiRuntimeImageGenerationResult,
  type NimiRuntimeScenarioJobClient,
  type ReadArtifactBytesResponse,
  type RuntimeTypedCallOptions,
  type ScenarioArtifact,
  type ScenarioExtension,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeImageGenerateUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable'
  | 'local-companion-missing';

export type RuntimeImageGenerateArtifactPreviewSource =
  | 'hosted-uri'
  | 'inline-bytes'
  | 'runtime-artifact-read'
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
  readonly runtimeRequest?: unknown;
};

export type RuntimeImageGenerateResult = RuntimeImageGenerateSuccess | RuntimeImageGenerateUnavailable;

export type RuntimeImageGenerateRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
  readonly artifacts?: RuntimeImageArtifactReadClient;
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeImageArtifactReadClient = {
  readonly readArtifactBytes: (
    request: { readonly artifactId: string },
    options?: RuntimeTypedCallOptions,
  ) => Promise<ReadArtifactBytesResponse>;
};

export type RuntimeImageGenerateScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export type RuntimeImageGenerateInput = {
  readonly runtime: RuntimeImageGenerateRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly withScopes?: RuntimeImageGenerateScopeRunner;
};

type SchedulingPreflight = {
  readonly unavailable: RuntimeImageGenerateUnavailable | null;
  readonly metadata: Record<string, string>;
};

type ImageProfileEntry = {
  readonly entry_id: string;
  readonly kind: 'asset';
  readonly title: string;
  readonly capability: string;
  readonly asset_id: string;
  readonly asset_kind: string;
  readonly engine: string;
  readonly engine_slot?: string;
  readonly required?: boolean;
};

export async function runRuntimeImageGenerate(
  input: RuntimeImageGenerateInput,
): Promise<RuntimeImageGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailable('input-invalid', 'Image prompt is required before dispatch.');
  }

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config: input.config,
    capabilityId: 'image.generate',
    bindingCapabilityId: 'image.generate',
  });
  if (resolved.ok === false) {
    return unavailable('ai-config-binding-missing', resolved.message);
  }

  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable('principal-unauthorized', 'Runtime account subjectUserId is required before image dispatch.');
  }

  let imageParams: NimiImageGenerationCoercedParams;
  try {
    imageParams = coerceNimiImageGenerationParams(paramRecord(resolved.binding.selectedParams));
  } catch (error) {
    return unavailable('input-invalid', describeError(error));
  }

  let profileExtensions: {
    readonly extensions: readonly ScenarioExtension[];
    readonly unavailable: RuntimeImageGenerateUnavailable | null;
  };
  try {
    profileExtensions = imageProfileExtensionsFromBinding(resolved.binding, imageParams);
  } catch (error) {
    return unavailable('input-invalid', describeError(error));
  }
  if (profileExtensions.unavailable) {
    return profileExtensions.unavailable;
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
        ...(imageParams.timeoutMs ? { timeoutMs: imageParams.timeoutMs } : {}),
      };
      const request = buildImageGenerationInput({
        input,
        binding: resolved.binding,
        prompt,
        subjectUserId,
        imageParams,
        extensions: profileExtensions.extensions,
        callOptions,
      });
      const generated = await runNimiRuntimeImageGeneration(request);
      const artifacts = await summarizeImageArtifacts(input.runtime.artifacts, generated.artifacts, callOptions);
      const firstArtifact = artifacts[0];
      return {
        ok: true,
        capabilityId: 'image.generate',
        message: `Runtime completed image job ${generated.job.jobId} with ${artifacts.length} artifact(s).`,
        output: {
          kind: 'image-artifacts',
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

function buildImageGenerationInput(input: {
  readonly input: RuntimeImageGenerateInput;
  readonly binding: NimiAIConfigRuntimeBinding;
  readonly prompt: string;
  readonly subjectUserId: string;
  readonly imageParams: NimiImageGenerationCoercedParams;
  readonly extensions: readonly ScenarioExtension[];
  readonly callOptions: RuntimeTypedCallOptions;
}): NimiRuntimeImageGenerationInput {
  return {
    runtime: { ai: input.input.runtime.ai },
    head: {
      appId: input.input.appId,
      subjectUserId: input.subjectUserId,
      modelId: input.binding.model,
      routePolicy: input.binding.routePolicy,
      connectorId: input.binding.connectorId,
      targetRef: toRuntimeDurableTargetRef(input.binding.targetRef),
      timeoutMs: input.imageParams.timeoutMs,
    },
    prompt: input.prompt,
    negativePrompt: normalizeText(input.input.negativePrompt) || input.imageParams.negativePrompt,
    count: input.imageParams.count,
    size: input.imageParams.size,
    aspectRatio: input.imageParams.aspectRatio,
    quality: input.imageParams.quality,
    style: input.imageParams.style,
    seed: input.imageParams.seed,
    referenceImages: input.imageParams.referenceImages,
    mask: input.imageParams.mask,
    responseFormat: input.imageParams.responseFormat,
    requestId: input.input.scenarioId,
    idempotencyKey: input.input.scenarioId,
    labels: buildLabels(input.input, input.binding),
    extensions: input.extensions,
    callOptions: input.callOptions,
    onJobUpdate: input.input.onJobUpdate,
  };
}

function imageProfileExtensionsFromBinding(
  binding: NimiAIConfigRuntimeBinding,
  imageParams: NimiImageGenerationCoercedParams,
): {
  readonly extensions: readonly ScenarioExtension[];
  readonly unavailable: RuntimeImageGenerateUnavailable | null;
} {
  if (binding.routePolicy !== 'local') {
    return { extensions: [], unavailable: null };
  }
  const params = paramRecord(binding.selectedParams);
  const profileEntries = configuredProfileEntries(params) ?? localProfileEntriesFromParams(binding, params);
  const missing = missingRequiredCompanionSlots(params, profileEntries);
  if (missing.length > 0) {
    return {
      extensions: [],
      unavailable: unavailable(
        'local-companion-missing',
        `image.generate model family ${imageModelFamily(params)} requires companion slot(s): ${missing.join(', ')}.`,
      ),
    };
  }
  if (profileEntries.length === 0) {
    return { extensions: [], unavailable: null };
  }
  const payload: NimiJsonObject = {
    ...imageParams.providerOptions,
    profile_overrides: {
      ...imageParams.providerOptions,
    },
    profile_entries: profileEntries as unknown as NimiJsonValue,
    ...entryOverrides(params),
  };
  return {
    extensions: [{
      namespace: 'nimi.scenario.image.request',
      payload: toNimiRuntimeProtoStruct(payload),
    }],
    unavailable: null,
  };
}

function configuredProfileEntries(params: Record<string, unknown>): readonly ImageProfileEntry[] | null {
  const configured = params.profile_entries ?? params.profileEntries;
  if (!Array.isArray(configured)) {
    return null;
  }
  const out: ImageProfileEntry[] = [];
  for (const item of configured) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('image.generate profile_entries must contain only JSON object entries.');
    }
    const record = item as Record<string, unknown>;
    out.push({
      entry_id: normalizeText(record.entry_id ?? record.entryId),
      kind: 'asset',
      title: normalizeText(record.title) || normalizeText(record.entry_id ?? record.entryId),
      capability: normalizeText(record.capability) || 'image',
      asset_id: normalizeText(record.asset_id ?? record.assetId),
      asset_kind: normalizeText(record.asset_kind ?? record.assetKind) || 'image',
      engine: normalizeText(record.engine) || 'media',
      ...(normalizeText(record.engine_slot ?? record.engineSlot)
        ? { engine_slot: normalizeText(record.engine_slot ?? record.engineSlot) }
        : {}),
      ...(typeof record.required === 'boolean' ? { required: record.required } : {}),
    });
  }
  return out;
}

function localProfileEntriesFromParams(
  binding: NimiAIConfigRuntimeBinding,
  params: Record<string, unknown>,
): readonly ImageProfileEntry[] {
  const modelAssetId = semanticLocalAssetId(binding.model);
  if (!modelAssetId) {
    return [];
  }
  const entries: ImageProfileEntry[] = [{
    entry_id: 'main-image',
    kind: 'asset',
    title: 'Image model',
    capability: 'image',
    asset_id: modelAssetId,
    asset_kind: 'image',
    engine: 'media',
  }];
  for (const slot of resolveNimiRuntimeImageCompanionSlots(imageModelFamily(params))) {
    const selected = normalizeText(companionSlots(params)[slot.engineSlot]);
    if (!selected) {
      continue;
    }
    entries.push({
      entry_id: `${slot.engineSlot}-slot`,
      kind: 'asset',
      title: slot.label,
      capability: 'image.generate',
      asset_id: semanticLocalAssetId(selected),
      asset_kind: slot.assetKind,
      engine: slot.assetKind === 'chat' ? 'llama' : 'media',
      engine_slot: slot.engineSlot,
      required: slot.required,
    });
  }
  return entries;
}

function missingRequiredCompanionSlots(
  params: Record<string, unknown>,
  profileEntries: readonly ImageProfileEntry[],
): readonly string[] {
  const family = imageModelFamily(params);
  if (!family) {
    return [];
  }
  const entriesBySlot = new Map<string, ImageProfileEntry>();
  for (const entry of profileEntries) {
    if (entry.engine_slot) {
      entriesBySlot.set(entry.engine_slot, entry);
    }
  }
  const missing: string[] = [];
  for (const slot of resolveNimiRuntimeImageCompanionSlots(family)) {
    if (!slot.required) {
      continue;
    }
    const entry = entriesBySlot.get(slot.engineSlot);
    if (!entry) {
      missing.push(slot.engineSlot);
      continue;
    }
    if (entry.asset_kind && entry.asset_kind !== slot.assetKind) {
      missing.push(`${slot.engineSlot}:${slot.assetKind}`);
    }
  }
  return missing;
}

function entryOverrides(params: Record<string, unknown>): Record<string, NimiJsonValue> {
  const raw = params.entry_overrides ?? params.entryOverrides;
  return Array.isArray(raw) ? { entry_overrides: raw as unknown as NimiJsonValue } : {};
}

function imageModelFamily(params: Record<string, unknown>): string {
  return normalizeText(params.modelFamily ?? params.model_family ?? params.runtimeModelFamily ?? params.runtime_model_family)
    .toLowerCase()
    .replaceAll('_', '-');
}

function companionSlots(params: Record<string, unknown>): Record<string, string> {
  const raw = params.companionSlots ?? params.companion_slots;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeText(value);
    if (normalized) {
      out[key] = normalized;
    }
  }
  return out;
}

async function summarizeImageArtifacts(
  artifactsClient: RuntimeImageArtifactReadClient | undefined,
  artifacts: readonly ScenarioArtifact[],
  options: RuntimeTypedCallOptions,
): Promise<readonly RuntimeImageGenerateArtifactSummary[]> {
  const summaries: RuntimeImageGenerateArtifactSummary[] = [];
  for (const artifact of artifacts) {
    summaries.push(await summarizeImageArtifact(artifactsClient, artifact, options));
  }
  return summaries;
}

async function summarizeImageArtifact(
  artifactsClient: RuntimeImageArtifactReadClient | undefined,
  artifact: ScenarioArtifact,
  options: RuntimeTypedCallOptions,
): Promise<RuntimeImageGenerateArtifactSummary> {
  const artifactId = normalizeText(artifact.artifactId);
  const mimeType = normalizeText(artifact.mimeType) || 'application/octet-stream';
  const uri = normalizeText(artifact.uri);
  const inlineBytes = byteArray(artifact.bytes);
  if (uri) {
    return artifactSummary(artifact, {
      artifactId,
      mimeType,
      uri,
      previewUrl: uri,
      previewSource: 'hosted-uri',
    });
  }
  if (inlineBytes.byteLength > 0) {
    return artifactSummary(artifact, {
      artifactId,
      mimeType,
      previewUrl: dataUrl(mimeType, inlineBytes),
      previewSource: 'inline-bytes',
    });
  }
  if (artifactId && artifactsClient) {
    const response = await artifactsClient.readArtifactBytes({ artifactId }, options);
    const readBytes = byteArray(response.bytes);
    if (readBytes.byteLength > 0) {
      return artifactSummary(artifact, {
        artifactId,
        mimeType: normalizeText(response.mimeType) || mimeType,
        previewUrl: dataUrl(normalizeText(response.mimeType) || mimeType, readBytes),
        previewSource: 'runtime-artifact-read',
        sizeBytes: integerOrUndefined(response.sizeBytes),
      });
    }
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
    readonly previewSource: RuntimeImageGenerateArtifactPreviewSource;
    readonly sizeBytes?: number;
  },
): RuntimeImageGenerateArtifactSummary {
  const sizeBytes = base.sizeBytes ?? integerOrUndefined(artifact.sizeBytes);
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

function withSpendMeterScope<T>(
  input: RuntimeImageGenerateInput,
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
): Promise<T> {
  if (!input.withScopes) {
    return operation({});
  }
  return input.withScopes(['ai.spend.meter'], operation);
}

async function ensureSchedulingPreflight(
  input: RuntimeImageGenerateInput,
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
          `Runtime scheduling denied image.generate: ${batch.aggregateJudgement.detail || 'denied'}`,
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
  input: RuntimeImageGenerateInput,
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
  input: RuntimeImageGenerateInput,
  binding: NimiAIConfigRuntimeBinding,
): Record<string, string> {
  return {
    appId: input.appId,
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    capabilityId: 'image.generate',
    bindingCapabilityId: binding.bindingCapabilityId,
    routePolicy: binding.routePolicy,
    targetRefKind: binding.targetRef.kind,
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

function paramRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function semanticLocalAssetId(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  if (text.toLowerCase().startsWith('local-runtime:')) {
    return text.slice('local-runtime:'.length).trim();
  }
  if (text.toLowerCase().startsWith('local/')) {
    return text.slice('local/'.length).trim();
  }
  return text;
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

function unavailableFromError(error: unknown): RuntimeImageGenerateUnavailable {
  const reasonCode = error && typeof error === 'object'
    ? String(
      (error as { reasonCode?: unknown }).reasonCode
      || (error as { code?: unknown }).code
      || '',
    )
    : '';
  const reason: RuntimeImageGenerateUnavailableReason = reasonCode === 'SDK_RUNTIME_METHOD_UNAVAILABLE'
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
  reason: RuntimeImageGenerateUnavailableReason,
  message: string,
): RuntimeImageGenerateUnavailable {
  return {
    ok: false,
    capabilityId: 'image.generate',
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
  return String(error || 'Runtime image generation failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
