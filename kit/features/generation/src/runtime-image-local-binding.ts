import {
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  createNimiRuntimeLocalModelCenterClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  listNimiRuntimeLocalAssetEntries,
  resolveNimiRuntimeImageCompanionSlots,
  withNimiRuntimeIdempotencyMetadata,
  type NimiAIConfigRuntimeBinding,
  type NimiJsonObject,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
  type NimiRuntimeLocalEnvironmentPlanInput,
  type NimiRuntimeLocalModelCenterRpc,
} from '@nimiplatform/kit/core/sdk-contract';

type ImageProfileEntry = NimiJsonObject & {
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

type ImageEntryOverride = NimiJsonObject & {
  readonly entry_id: string;
  readonly local_asset_id: string;
};

type ImageEnvironmentPlanInput = NimiRuntimeLocalEnvironmentPlanInput & {
  readonly packId: 'local-image-native';
};

export type RuntimeImageLocalRuntime = {
  readonly local?: NimiRuntimeLocalModelCenterRpc;
};

export type RuntimeImageLocalUnavailableReason =
  | 'input-invalid'
  | 'local-companion-missing'
  | 'local-environment-blocked'
  | 'local-environment-preparing'
  | 'runtime-call-failed';

export type RuntimeImageLocalUnavailable = {
  readonly reason: RuntimeImageLocalUnavailableReason;
  readonly message: string;
};

export type RuntimeImageBindingMaterialization = {
  readonly binding: NimiAIConfigRuntimeBinding;
};

class RuntimeImageLocalBindingError extends Error {
  readonly reason: RuntimeImageLocalUnavailableReason;

  constructor(reason: RuntimeImageLocalUnavailableReason, message: string) {
    super(message);
    this.name = 'RuntimeImageLocalBindingError';
    this.reason = reason;
  }
}

export async function materializeRuntimeImageBinding(input: {
  readonly runtime: RuntimeImageLocalRuntime;
  readonly binding: NimiAIConfigRuntimeBinding;
}): Promise<
  | { readonly ok: true; readonly value: RuntimeImageBindingMaterialization }
  | { readonly ok: false; readonly unavailable: RuntimeImageLocalUnavailable }
> {
  try {
    return { ok: true, value: { binding: await imageBindingForRuntime(input.runtime, input.binding) } };
  } catch (error) {
    if (error instanceof RuntimeImageLocalBindingError) {
      return {
        ok: false,
        unavailable: {
          reason: error.reason,
          message: error.message,
        },
      };
    }
    return {
      ok: false,
      unavailable: {
        reason: 'input-invalid',
        message: error instanceof Error ? error.message : String(error || 'image.generate local binding materialization failed.'),
      },
    };
  }
}

export async function ensureRuntimeLocalImageEnvironmentReady(input: {
  readonly runtime: RuntimeImageLocalRuntime;
  readonly binding: NimiAIConfigRuntimeBinding;
  readonly runIdempotencyKey: string;
}): Promise<RuntimeImageLocalUnavailable | null> {
  const resolved = input.binding;
  if (resolved.routePolicy !== 'local') return null;
  if (!input.runtime.local) {
    return {
      reason: 'runtime-call-failed',
      message: 'image.generate local model setup requires Runtime local environment APIs; reload Runtime projection and retry.',
    };
  }

  const local = createNimiRuntimeLocalModelCenterClient({ local: input.runtime.local });
  const planInputs = localImageEnvironmentPlanInputs(resolved);
  const plans = await Promise.all(planInputs.map((planInput) => local.resolveEnvironmentPlan(planInput)));
  const hasConcreteCompanionInputs = planInputs.some((planInput) => Boolean(planInput.companionAssetId && planInput.parentAssetId));
  const blocked = dedupeDependencies(plans.flatMap(nonReadyRequiredDependencies))
    .filter((dependency) => !(hasConcreteCompanionInputs && isImageProfileBindingsDependency(dependency)));
  if (blocked.length === 0) return null;

  const jobsByDependency = await Promise.all(blocked.map(async (dependency) => ({
    dependency,
    job: latestJobForDependency(
      await local.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey }),
      dependency,
    ),
  })));
  const startable = jobsByDependency
    .filter(({ dependency, job }) =>
      dependency.confirmationRequired &&
      isNimiRuntimeLocalEnvironmentDependencyStartableState(dependency.state)
      && !job)
    .map(({ dependency }) => dependency);

  if (startable.length > 0) {
    await Promise.all(startable.map((dependency, index) =>
      local.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
        consumerScope: dependency.consumerScope,
      }, {
        caller: 'core',
        callOptions: withNimiRuntimeIdempotencyMetadata(
          undefined,
          dependencyJobIdempotencyKey(input.runIdempotencyKey, index),
        ),
      }),
    ));
  }

  const activeCount = jobsByDependency.filter(({ job }) =>
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job?.state)).length;
  const summary = summarizeLocalImageDependencies(blocked);
  const profileBindingBlockers = blocked.filter(isImageProfileBindingsDependency);
  if (!hasConcreteCompanionInputs && profileBindingBlockers.length > 0) {
    const startedNote = startable.length > 0
      ? ` Runtime local image setup started ${startable.length} dependency job(s).`
      : '';
    return {
      reason: 'local-environment-blocked',
      message: `Local image generation requires concrete companion model bindings before Runtime can resolve profile setup.${startedNote} Pending dependencies: ${summary}`,
    };
  }
  const planState = [...new Set(plans.map((plan) => plan.state).filter(Boolean))].join(',') || 'unknown';
  return {
    reason: 'local-environment-preparing',
    message: startable.length > 0
      ? `Runtime local image setup started ${startable.length} dependency job(s). Pending dependencies: ${summary}`
      : `Runtime local image setup is still preparing (${activeCount} active job(s), plan=${planState}). Pending dependencies: ${summary}`,
  };
}

async function imageBindingForRuntime(
  runtime: RuntimeImageLocalRuntime,
  resolved: NimiAIConfigRuntimeBinding,
): Promise<NimiAIConfigRuntimeBinding> {
  const params = selectedParamRecord(resolved);
  const configuredEntries = configuredImageProfileEntries(params);
  if (configuredEntries) {
    assertRequiredConfiguredImageCompanions(imageModelFamily(params), configuredEntries);
    const configuredModel = imageModelAssetIdFromConfiguredEntries(configuredEntries);
    return configuredModel ? {
      ...resolved,
      model: configuredModel,
      metadata: {
        ...resolved.metadata,
        aiConfigRuntimeModelAssetId: configuredModel,
      },
    } : resolved;
  }

  if (resolved.routePolicy !== 'local') {
    return {
      ...resolved,
      selectedParams: {
        ...params,
        profile_entries: [{
          entry_id: 'main-image',
          kind: 'asset',
          title: 'Main image model',
          capability: 'image.generate',
          asset_id: resolved.model,
          asset_kind: 'image',
          engine: 'media',
          required: true,
        }],
      },
    };
  }

  if (!runtime.local) {
    assertSelectedCompanionSlots(imageModelFamily(params), selectedCompanionSlots(params));
    throw new RuntimeImageLocalBindingError(
      'runtime-call-failed',
      'image.generate local model binding requires Runtime local asset listing; reload Runtime projection and reselect the Image active model.',
    );
  }
  const assets = await listNimiRuntimeLocalAssetEntries({ local: runtime.local });
  const mainAsset = findLocalAssetById(assets, resolved.model);
  if (!mainAsset) {
    throw new Error(`image.generate active model ${resolved.model} is not present in Runtime local assets; reselect the Image active model.`);
  }
  if (mainAsset.kind !== 'image') {
    throw new Error(`image.generate active model ${resolved.model} resolves to local asset kind ${mainAsset.kind}; expected image.`);
  }

  const imageFamily = selectedImageModelFamily(params, mainAsset);
  const companionSelections = selectedCompanionSlots(params);
  assertSelectedCompanionSlots(imageFamily, companionSelections);
  const slotsByEngineSlot = new Map(
    resolveNimiRuntimeImageCompanionSlots(imageFamily).map((slot) => [slot.engineSlot, slot]),
  );
  const profileEntries: ImageProfileEntry[] = [
    imageProfileEntryForAsset({
      entryId: 'main-image',
      title: 'Main image model',
      capability: 'image.generate',
      asset: mainAsset,
      required: true,
    }),
  ];
  const entryOverrides: ImageEntryOverride[] = [{
    entry_id: 'main-image',
    local_asset_id: mainAsset.localAssetId,
  }];

  for (const [engineSlot, selected] of Object.entries(companionSelections)) {
    const slot = slotsByEngineSlot.get(engineSlot);
    const asset = findLocalAssetById(assets, selected);
    if (!asset) {
      throw new Error(`image.generate companion slot ${engineSlot} references missing Runtime local asset ${selected}; reselect the companion model.`);
    }
    if (slot && asset.kind !== slot.assetKind) {
      throw new Error(`image.generate companion slot ${engineSlot} requires a ${slot.assetKind} asset; reselect the companion model.`);
    }
    const entryId = imageCompanionEntryId(engineSlot);
    profileEntries.push(imageProfileEntryForAsset({
      entryId,
      title: `${slot?.label ?? engineSlot} companion`,
      capability: 'image.generate',
      asset,
      engineSlot,
      required: slot?.required,
    }));
    entryOverrides.push({
      entry_id: entryId,
      local_asset_id: asset.localAssetId,
    });
  }

  const model = requiredSemanticAssetId(mainAsset, 'image.generate');
  return {
    ...resolved,
    model,
    metadata: {
      ...resolved.metadata,
      aiConfigRuntimeModelAssetId: model,
      aiConfigRuntimeModelLocalAssetId: mainAsset.localAssetId,
    },
    selectedParams: {
      ...params,
      profile_entries: profileEntries,
      entry_overrides: entryOverrides,
    },
  };
}

function localImageEnvironmentPlanInputs(binding: NimiAIConfigRuntimeBinding): readonly ImageEnvironmentPlanInput[] {
  const params = selectedParamRecord(binding);
  const profileEntries = configuredImageProfileEntries(params) ?? [];
  const entryOverrides = configuredImageEntryOverrides(params);
  const assetId = normalizeText(binding.metadata.aiConfigRuntimeModelAssetId) || binding.model;
  const localAssetId = normalizeText(binding.metadata.aiConfigRuntimeModelLocalAssetId)
    || localAssetIdForEntry('main-image', entryOverrides);
  const base = buildNimiRuntimeLocalImageNativeEnvironmentPlanInput({
    assetId,
    localAssetId,
  });
  const inputs: ImageEnvironmentPlanInput[] = [base];
  const mainEntryAssetId = profileEntries
    .map((entry) => localImageProfileEntryEngineSlot(entry) ? '' : localImageProfileEntryAssetID(entry))
    .find(Boolean) || assetId;
  for (const entry of profileEntries) {
    if (!localImageProfileEntryEngineSlot(entry)) continue;
    const companionAssetId = localImageProfileEntryAssetID(entry);
    if (!companionAssetId || !mainEntryAssetId) continue;
    inputs.push({
      ...base,
      companionAssetId,
      parentAssetId: mainEntryAssetId,
    });
  }
  return inputs;
}

function selectedParamRecord(resolved: NimiAIConfigRuntimeBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function configuredImageProfileEntries(params: Record<string, unknown>): ImageProfileEntry[] | null {
  const configuredEntries = Array.isArray(params.profile_entries)
    ? params.profile_entries
    : Array.isArray(params.profileEntries) ? params.profileEntries : null;
  if (!configuredEntries || configuredEntries.length === 0) return null;
  const entries = configuredEntries.filter(isJsonRecord);
  if (entries.length !== configuredEntries.length) {
    throw new Error('image.generate profile_entries must contain only JSON object entries.');
  }
  return entries.map((entry) => ({
    entry_id: normalizeText(entry.entry_id ?? entry.entryId),
    kind: 'asset',
    title: normalizeText(entry.title) || normalizeText(entry.entry_id ?? entry.entryId),
    capability: normalizeText(entry.capability) || 'image.generate',
    asset_id: normalizeText(entry.asset_id ?? entry.assetId),
    asset_kind: normalizeText(entry.asset_kind ?? entry.assetKind) || 'image',
    engine: normalizeText(entry.engine) || 'media',
    ...(normalizeText(entry.engine_slot ?? entry.engineSlot)
      ? { engine_slot: normalizeText(entry.engine_slot ?? entry.engineSlot) }
      : {}),
    ...(typeof entry.required === 'boolean' ? { required: entry.required } : {}),
  }));
}

function configuredImageEntryOverrides(params: Record<string, unknown>): readonly ImageEntryOverride[] {
  const raw = params.entry_overrides ?? params.entryOverrides;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isJsonRecord).map((entry) => ({
    entry_id: normalizeText(entry.entry_id ?? entry.entryId),
    local_asset_id: normalizeText(entry.local_asset_id ?? entry.localAssetId),
  })).filter((entry) => entry.entry_id && entry.local_asset_id);
}

function isJsonRecord(value: unknown): value is NimiJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function selectedCompanionSlots(params: Record<string, unknown>): Record<string, string> {
  const raw = params.companionSlots ?? params.companion_slots;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeText(value);
    if (slot.trim() && normalized) {
      out[slot.trim()] = normalized;
    }
  }
  return out;
}

function selectedImageModelFamily(params: Record<string, unknown>, mainAsset: NimiRuntimeLocalAssetEntry | null): string {
  return normalizeImageFamily(
    params.modelFamily
    ?? params.model_family
    ?? params.runtimeModelFamily
    ?? params.runtime_model_family,
  ) || normalizeImageFamily(localAssetFamily(mainAsset));
}

function imageModelFamily(params: Record<string, unknown>): string {
  return normalizeImageFamily(
    params.modelFamily
    ?? params.model_family
    ?? params.runtimeModelFamily
    ?? params.runtime_model_family,
  );
}

function normalizeImageFamily(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase().replaceAll('_', '-');
  return normalized === 'z-image-base' ? 'z-image' : normalized;
}

function localAssetFamily(asset: NimiRuntimeLocalAssetEntry | null): string {
  if (!asset) return '';
  const extensible = asset as NimiRuntimeLocalAssetEntry & {
    readonly family?: unknown;
    readonly modelFamily?: unknown;
    readonly model_family?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  return normalizeText(
    extensible.modelFamily
    ?? extensible.model_family
    ?? extensible.family
    ?? extensible.metadata?.modelFamily
    ?? extensible.metadata?.model_family
    ?? extensible.metadata?.family,
  );
}

function imageEntryAssetId(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const record = entry as Record<string, unknown>;
  const slot = normalizeText(record.engine_slot ?? record.engineSlot);
  if (slot) return '';
  const kind = normalizeText(record.asset_kind ?? record.assetKind).toLowerCase();
  if (kind && kind !== 'image' && kind !== 'local_asset_kind_image') return '';
  return normalizeText(record.asset_id ?? record.assetId);
}

function imageModelAssetIdFromConfiguredEntries(entries: readonly unknown[]): string {
  for (const entry of entries) {
    const assetId = imageEntryAssetId(entry);
    if (assetId) return assetId;
  }
  return '';
}

function assertRequiredConfiguredImageCompanions(modelFamily: string, entries: readonly ImageProfileEntry[]) {
  if (!modelFamily) return;
  const slots = resolveNimiRuntimeImageCompanionSlots(modelFamily);
  if (slots.length === 0) return;
  const bySlot = new Map<string, ImageProfileEntry>();
  for (const entry of entries) {
    if (entry.engine_slot) bySlot.set(entry.engine_slot, entry);
  }
  for (const slot of slots) {
    if (!slot.required) continue;
    const entry = bySlot.get(slot.engineSlot);
    if (!entry) {
      throw new RuntimeImageLocalBindingError(
        'local-companion-missing',
        `image.generate model family ${modelFamily} requires companion slot ${slot.engineSlot}; configure the companion model before running.`,
      );
    }
    if (entry.asset_kind && entry.asset_kind !== slot.assetKind) {
      throw new Error(`image.generate companion slot ${slot.engineSlot} requires a ${slot.assetKind} asset; reselect the companion model.`);
    }
  }
}

function assertSelectedCompanionSlots(modelFamily: string, companionSelections: Record<string, string>) {
  if (!modelFamily) return;
  for (const slot of resolveNimiRuntimeImageCompanionSlots(modelFamily)) {
    if (slot.required && !companionSelections[slot.engineSlot]) {
      throw new RuntimeImageLocalBindingError(
        'local-companion-missing',
        `image.generate model family ${modelFamily} requires companion slot ${slot.engineSlot}; configure the companion model before running.`,
      );
    }
  }
}

function imageProfileEntryForAsset(input: {
  readonly entryId: string;
  readonly title: string;
  readonly capability: string;
  readonly asset: NimiRuntimeLocalAssetEntry;
  readonly engineSlot?: string;
  readonly required?: boolean;
}): ImageProfileEntry {
  return {
    entry_id: input.entryId,
    kind: 'asset',
    title: input.title,
    capability: input.capability,
    asset_id: requiredSemanticAssetId(input.asset, input.title),
    asset_kind: input.asset.kind,
    engine: input.asset.engine,
    ...(input.engineSlot ? { engine_slot: input.engineSlot } : {}),
    ...(typeof input.required === 'boolean' ? { required: input.required } : {}),
  };
}

function imageCompanionEntryId(engineSlot: string): string {
  return `companion-${engineSlot.replace(/_path$/u, '').replace(/[^a-zA-Z0-9._:-]+/gu, '-')}`;
}

function requiredSemanticAssetId(asset: NimiRuntimeLocalAssetEntry, context: string): string {
  const assetId = normalizeText(asset.assetId);
  if (!assetId) {
    throw new Error(`${context} Runtime local asset ${asset.localAssetId} is missing semantic assetId; reload Runtime projection and re-import the asset.`);
  }
  return assetId;
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

function latestJobForDependency(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId
      && job.consumerScope === dependency.consumerScope)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function nonReadyRequiredDependencies(plan: NimiRuntimeLocalEnvironmentPlan): readonly NimiRuntimeLocalEnvironmentPlanDependency[] {
  return plan.dependencies.filter((dependency) =>
    dependency.required && !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state));
}

function dedupeDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): readonly NimiRuntimeLocalEnvironmentPlanDependency[] {
  const seen = new Set<string>();
  const out: NimiRuntimeLocalEnvironmentPlanDependency[] = [];
  for (const dependency of dependencies) {
    const key = [
      dependency.environmentKey,
      dependency.dependencyFamily,
      dependency.dependencyId,
      dependency.consumerScope,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dependency);
  }
  return out;
}

function summarizeLocalImageDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): string {
  return dependencies
    .slice(0, 6)
    .map((dependency) => `${dependency.dependencyFamily}:${dependency.dependencyId} state=${dependency.state}`)
    .join('; ');
}

function dependencyJobIdempotencyKey(baseIdempotencyKey: string, index: number): string {
  return `${baseIdempotencyKey}:local-image-env:${index + 1}`;
}

function localImageProfileEntryAssetID(entry: unknown): string {
  return profileEntryText(entry, 'asset_id', 'assetId');
}

function localImageProfileEntryEngineSlot(entry: unknown): string {
  return profileEntryText(entry, 'engine_slot', 'engineSlot');
}

function profileEntryText(entry: unknown, snakeKey: string, camelKey: string): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const record = entry as Record<string, unknown>;
  return normalizeText(record[snakeKey] ?? record[camelKey]);
}

function localAssetIdForEntry(entryId: string, overrides: readonly ImageEntryOverride[]): string {
  return overrides.find((entry) => entry.entry_id === entryId)?.local_asset_id ?? '';
}

function isImageProfileBindingsDependency(dependency: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  return dependency.dependencyFamily === 'model.companion-asset'
    && dependency.dependencyId.startsWith('image-profile-bindings:');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
