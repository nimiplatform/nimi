import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileInput,
  type NimiPortableAIProfileLoadoutAxis,
} from '@nimiplatform/sdk/ai';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { createNimiError, isNimiErrorLike } from '@nimiplatform/sdk/types';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiMachineLoadoutClient,
  NimiRuntimeLocalEnvironmentClient,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';

export type RuntimeConfigAIProfileTransferAxis = {
  readonly capabilityContract: string;
  readonly slotId: string;
  readonly contentId: string;
  readonly expectedHash: string;
  readonly displayLabel: string;
  readonly sizeBytes: number;
  readonly state: 'matched' | 'download-required' | 'content-only' | 'hash-mismatch';
  readonly modelAssetId?: string;
  readonly templateId?: string;
  readonly source?: NimiPortableAIProfileLoadoutAxis['source'];
  readonly reasonCode?: string;
};

export type RuntimeConfigAIProfileTransferCapability = {
  readonly capabilityContract: string;
  readonly recipeId: string;
  readonly state: 'ready' | 'upgrade-required';
  readonly recipe?: NimiLoadoutRecipe;
  readonly existingLoadoutId?: string;
  readonly existingLoadout?: NimiMachineLoadout;
  readonly axes: readonly RuntimeConfigAIProfileTransferAxis[];
  readonly reasonCode?: string;
};

export type RuntimeConfigAIProfileTransferPlan = {
  readonly profile: NimiPortableAIProfile;
  readonly capabilities: readonly RuntimeConfigAIProfileTransferCapability[];
  readonly downloads: readonly RuntimeConfigAIProfileTransferAxis[];
  readonly totalDownloadBytes: number | null;
  readonly networkStarted: false;
};

export type RuntimeConfigAIProfileTransferCapabilityResult = {
  readonly capabilityContract: string;
  readonly state: 'committed' | 'failed' | 'upgrade-required';
  readonly loadout?: NimiMachineLoadout;
  readonly unresolvedSlotIds: readonly string[];
  readonly reasonCode?: string;
  readonly detail?: string;
};

export type RuntimeConfigAIProfileTransferResult = {
  readonly profile: NimiPortableAIProfile;
  readonly capabilities: readonly RuntimeConfigAIProfileTransferCapabilityResult[];
  readonly installedModelAssetIds: readonly string[];
  readonly appAIConfigApplied: boolean;
};

type RuntimeConfigAIProfileDownloadGroup = {
  readonly contentId: string;
  readonly representative: RuntimeConfigAIProfileTransferAxis;
  readonly acquisitionOccurrences: readonly RuntimeConfigAIProfileTransferAxis[];
  readonly occurrences: readonly RuntimeConfigAIProfileTransferAxis[];
};

type LocalEnvironmentClient = Pick<NimiRuntimeLocalEnvironmentClient,
  'listModelAssets' | 'listVerifiedAssets' | 'resolveInstallPlan' | 'install'
>;

type Loadouts = Pick<NimiMachineLoadoutClient,
  'listRecipes' | 'prepare' | 'commit' | 'select'
>;

// @nimi-authority: rule.nimi.runtime.local-compute.r028
export function exportRuntimeConfigAIProfileFromLoadouts(input: {
  readonly profileId: string;
  readonly title: string;
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
}): { readonly profile: NimiPortableAIProfile; readonly artifactJson: string } {
  if (input.loadouts.length === 0) throw new Error('Select at least one Loadout to export.');
  const assets = new Map(input.assets.map((asset) => [asset.modelAssetId, asset]));
  const capabilities: Record<string, NimiPortableAIProfile['capabilities'][string]> = {};
  for (const loadout of input.loadouts) {
    if (capabilities[loadout.capabilityContract]) {
      throw new Error(`Only one Loadout per capability can be exported: ${loadout.capabilityContract}.`);
    }
    const axes = loadout.modelAxes.map((axis) => {
      const asset = assets.get(axis.modelAssetId);
      if (!asset || asset.contentId !== axis.expectedContentId) {
        throw new Error(`${loadout.displayName}: ${axis.slotId} has no matching verified ModelAsset.`);
      }
      const entry = asset.files.find((file) => file.relativePath === asset.entry) ?? asset.files[0];
      if (!entry) throw new Error(`${loadout.displayName}: ${axis.slotId} has no verified payload file.`);
      const repo = textFact(asset.provenance?.source_repo);
      const revision = textFact(asset.provenance?.source_revision);
      const portableSource = Boolean(repo && revision);
      return Object.freeze({
        slotId: axis.slotId,
        contentId: asset.contentId as `sha256:${string}`,
        expectedHash: exactSHA256(entry.sha256, `${loadout.displayName}: ${axis.slotId}`),
        ...(portableSource ? {
          source: Object.freeze({
            repo,
            revision,
            file: entry.relativePath,
            sizeBytes: asset.totalSizeBytes,
          }),
        } : {}),
      });
    });
    capabilities[loadout.capabilityContract] = Object.freeze({
      route: 'local',
      requiredFeatures: Object.freeze([...loadout.supportedFeatures]),
      implementation: Object.freeze({
        ...loadout.implementation,
        supportedFeatures: Object.freeze([...loadout.supportedFeatures]),
      }),
      loadout: Object.freeze({
        recipeId: loadout.recipeId,
        axes: Object.freeze(axes),
        options: portableJsonObject(loadout.options),
      }),
    });
  }
  const profile = parseNimiPortableAIProfile({
    profileId: input.profileId,
    title: input.title,
    capabilities,
    displayMetadata: { exportedLoadoutCount: input.loadouts.length },
  });
  return Object.freeze({ profile, artifactJson: serializeNimiPortableAIProfile(profile) });
}

export async function planRuntimeConfigAIProfileTransfer(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly loadouts?: readonly NimiMachineLoadout[];
}): Promise<RuntimeConfigAIProfileTransferPlan> {
  const profile = parseNimiPortableAIProfile(input.profile);
  const assetsByContent = new Map(input.assets.map((asset) => [asset.contentId, asset]));
  const capabilities: RuntimeConfigAIProfileTransferCapability[] = [];
  for (const [capabilityContract, capability] of Object.entries(profile.capabilities)) {
    if (capability.route !== 'local' || !capability.loadout) continue;
    const recipe = input.recipes.find((item) => item.recipeId === capability.loadout?.recipeId);
    const existingLoadout = [...(input.loadouts ?? [])]
      .filter((loadout) => loadout.capabilityContract === capabilityContract)
      .filter((loadout) => textFact(loadout.provenance.source_profile_id) === profile.profileId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const existingLoadoutId = existingLoadout?.loadoutId;
    if (!recipe || recipe.capabilityContract !== capabilityContract ||
      !sameImplementation(recipe, capability.implementation)) {
      capabilities.push(Object.freeze({
        capabilityContract,
        recipeId: capability.loadout.recipeId,
        state: 'upgrade-required' as const,
        axes: Object.freeze([]),
        reasonCode: !recipe || recipe.capabilityContract !== capabilityContract
          ? 'AI_PROFILE_RECIPE_UPGRADE_REQUIRED'
          : 'AI_PROFILE_RECIPE_IMPLEMENTATION_MISMATCH',
        ...(existingLoadoutId ? { existingLoadoutId } : {}),
        ...(existingLoadout ? { existingLoadout } : {}),
      }));
      continue;
    }
    const axes = capability.loadout.axes.map((axis) => {
      const slot = recipe.slots.find((item) => item.slotId === axis.slotId);
      if (!slot) {
        return Object.freeze({
          capabilityContract,
          slotId: axis.slotId,
          contentId: axis.contentId,
          expectedHash: axis.expectedHash,
          displayLabel: axis.slotId,
          sizeBytes: axis.source?.sizeBytes ?? 0,
          state: 'content-only' as const,
          reasonCode: 'AI_PROFILE_LOADOUT_SLOT_UNKNOWN',
          ...(axis.source ? { source: axis.source } : {}),
        });
      }
      const existing = assetsByContent.get(axis.contentId);
      if (existing) {
        const hashMatches = matchesExpectedAxisIntegrity(existing, axis);
        return Object.freeze({
          capabilityContract,
          slotId: axis.slotId,
          contentId: axis.contentId,
          expectedHash: axis.expectedHash,
          displayLabel: slot.displayLabel,
          sizeBytes: existing.totalSizeBytes,
          state: hashMatches ? 'matched' as const : 'hash-mismatch' as const,
          modelAssetId: existing.modelAssetId,
          ...(hashMatches ? {} : { reasonCode: 'AI_PROFILE_MODEL_HASH_MISMATCH' }),
        });
      }
      const recommendationIndex = slot.recommendedContentIds.indexOf(axis.contentId);
      const recommendedTemplateId = recommendationIndex >= 0 ? slot.recommendedVariantIds[recommendationIndex] : undefined;
      const descriptor = axis.source
        ? verifiedDescriptorForPortableSource(
          axis.source,
          axis.expectedHash,
          axis.contentId,
          input.verifiedAssets,
          recommendedTemplateId,
        )
        : undefined;
      const templateId = descriptor?.templateId;
      if (axis.source) {
        if (axis.contentId !== axis.expectedHash && !templateId) {
          return Object.freeze({
            capabilityContract,
            slotId: axis.slotId,
            contentId: axis.contentId,
            expectedHash: axis.expectedHash,
            displayLabel: slot.displayLabel,
            sizeBytes: 0,
            state: 'content-only' as const,
            reasonCode: 'AI_PROFILE_MODEL_SOURCE_REQUIRED',
            source: axis.source,
          });
        }
        return Object.freeze({
          capabilityContract,
          slotId: axis.slotId,
          contentId: axis.contentId,
          expectedHash: axis.expectedHash,
          displayLabel: slot.displayLabel,
          sizeBytes: descriptor?.totalSizeBytes ?? axis.source.sizeBytes ?? 0,
          state: 'download-required' as const,
          ...(templateId ? { templateId } : {}),
          source: axis.source,
        });
      }
      return Object.freeze({
        capabilityContract,
        slotId: axis.slotId,
        contentId: axis.contentId,
        expectedHash: axis.expectedHash,
        displayLabel: slot.displayLabel,
        sizeBytes: 0,
        state: 'content-only' as const,
        reasonCode: 'AI_PROFILE_MODEL_SOURCE_REQUIRED',
      });
    });
    capabilities.push(Object.freeze({
      capabilityContract,
      recipeId: recipe.recipeId,
      state: 'ready' as const,
      recipe,
      axes: Object.freeze(axes),
      ...(existingLoadoutId ? { existingLoadoutId } : {}),
      ...(existingLoadout ? { existingLoadout } : {}),
    }));
  }
  const downloadGroups = groupRuntimeConfigAIProfileDownloads(capabilities);
  const downloads = Object.freeze(downloadGroups.map((group) => group.representative));
  return Object.freeze({
    profile,
    capabilities: Object.freeze(capabilities),
    downloads,
    totalDownloadBytes: downloads.every((item) => Number.isFinite(item.sizeBytes) && item.sizeBytes > 0)
      ? downloads.reduce((total, item) => total + item.sizeBytes, 0)
      : null,
    networkStarted: false as const,
  });
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
// @nimi-authority: rule.nimi.runtime.local-compute.r028
export async function executeRuntimeConfigAIProfileTransfer(input: {
  readonly plan: RuntimeConfigAIProfileTransferPlan;
  readonly assets: LocalEnvironmentClient;
  readonly loadouts: Loadouts;
  /** True only after the aggregate transfer page displays machine-wide Loadout impact. */
  readonly confirmedMachineImpact?: boolean;
  readonly applyAIProfile: (profile: NimiPortableAIProfile) => Promise<unknown>;
}): Promise<RuntimeConfigAIProfileTransferResult> {
  const resolved = new Map<string, NimiRuntimeModelAssetRecord>();
  const installedModelAssetIds: string[] = [];
  const failures = new Map<string, { readonly reasonCode: string; readonly detail: string }>();
  const inventory = await input.assets.listModelAssets();
  for (const capability of input.plan.capabilities) {
    for (const axis of capability.axes) {
      if (axis.state === 'matched' && axis.modelAssetId) {
        const asset = inventory.find((item) => item.modelAssetId === axis.modelAssetId);
        if (asset) resolved.set(axisKey(capability.capabilityContract, axis.slotId), asset);
      }
    }
  }

  // Persist an ordinary unresolved Loadout before starting a confirmed
  // transfer. If Desktop exits mid-transfer, the downloaded ModelAssets and
  // this visible Loadout are sufficient for the next import to resume or for
  // the user to discard it explicitly.
  const draftLoadoutIds = new Map<string, string>();
  const draftLoadouts = new Map<string, NimiMachineLoadout>();
  const draftFailures = new Set<string>();
  for (const capability of input.plan.capabilities) {
    if (capability.state !== 'ready' || !capability.recipe ||
      !capability.axes.some((axis) => axis.state === 'download-required')) continue;
    if (capability.existingLoadoutId) {
      draftLoadoutIds.set(capability.capabilityContract, capability.existingLoadoutId);
      if (capability.existingLoadout) draftLoadouts.set(capability.capabilityContract, capability.existingLoadout);
      continue;
    }
    const source = input.plan.profile.capabilities[capability.capabilityContract];
    if (!source || source.route !== 'local' || !source.loadout) continue;
    try {
      const prepared = await input.loadouts.prepare({
        capabilityContract: capability.capabilityContract,
        recipeId: capability.recipeId,
        options: source.loadout.options,
        supportedFeatures: source.implementation?.supportedFeatures ?? [],
        modelAxes: capability.axes.map((axis) => {
          const asset = resolved.get(axisKey(capability.capabilityContract, axis.slotId));
          return asset
            ? { slotId: axis.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId }
            : { slotId: axis.slotId, expectedContentId: axis.contentId };
        }),
        displayName: `${input.plan.profile.title} · ${capability.recipe.title}`,
        provenance: { source_profile_id: input.plan.profile.profileId },
      });
      const draft = await input.loadouts.commit(
        prepared.prepareId,
        prepared.impact?.confirmationRequired === true && input.confirmedMachineImpact === true,
      );
      draftLoadoutIds.set(capability.capabilityContract, draft.loadoutId);
      draftLoadouts.set(capability.capabilityContract, draft);
    } catch (error) {
      draftFailures.add(capability.capabilityContract);
      failures.set(axisKey(capability.capabilityContract, ''), {
        reasonCode: 'AI_PROFILE_LOADOUT_DRAFT_FAILED',
        detail: errorMessage(error),
      });
    }
  }
  const downloadGroups = groupRuntimeConfigAIProfileDownloads(input.plan.capabilities);
  const acquisitions = await Promise.all(downloadGroups.map(async (group) => {
    const eligibleOccurrences = group.acquisitionOccurrences
      .filter((axis) => !draftFailures.has(axis.capabilityContract));
    if (eligibleOccurrences.length === 0) return { group } as const;
    const axis = eligibleOccurrences[0]!;
    try {
      const installed = axis.templateId
        ? await installCatalogTemplate(input.assets, axis.templateId)
        : await installRecommendedSource(input.assets, axis);
      for (const occurrence of group.occurrences) verifyInstalledAxis(installed, occurrence);
      return { group, installed } as const;
    } catch (error) {
      return { group, error } as const;
    }
  }));
  for (const acquisition of acquisitions) {
    if ('installed' in acquisition && acquisition.installed !== undefined) {
      installedModelAssetIds.push(acquisition.installed.modelAssetId);
      for (const occurrence of acquisition.group.occurrences) {
        resolved.set(axisKey(occurrence.capabilityContract, occurrence.slotId), acquisition.installed);
      }
      continue;
    }
    if (!('error' in acquisition)) continue;
    const detail = errorMessage(acquisition.error);
    const reasonCode = runtimeConfigAIProfileAcquisitionReasonCode(acquisition.error);
    for (const occurrence of acquisition.group.occurrences) {
      failures.set(axisKey(occurrence.capabilityContract, occurrence.slotId), {
        reasonCode,
        detail,
      });
    }
  }

  const results: RuntimeConfigAIProfileTransferCapabilityResult[] = [];
  for (const capability of input.plan.capabilities) {
    if (capability.state === 'upgrade-required' || !capability.recipe) {
      results.push(Object.freeze({
        capabilityContract: capability.capabilityContract,
        state: 'upgrade-required',
        unresolvedSlotIds: Object.freeze([]),
        reasonCode: capability.reasonCode,
      }));
      continue;
    }
    const source = input.plan.profile.capabilities[capability.capabilityContract];
    if (!source || source.route !== 'local' || !source.loadout) continue;
    if (draftFailures.has(capability.capabilityContract)) {
      const failure = failures.get(axisKey(capability.capabilityContract, ''));
      results.push(Object.freeze({
        capabilityContract: capability.capabilityContract,
        state: 'failed' as const,
        ...(draftLoadouts.get(capability.capabilityContract)
          ? { loadout: draftLoadouts.get(capability.capabilityContract) }
          : {}),
        unresolvedSlotIds: Object.freeze(capability.axes.map((axis) => axis.slotId)),
        reasonCode: failure?.reasonCode ?? 'AI_PROFILE_LOADOUT_DRAFT_FAILED',
        detail: failure?.detail,
      }));
      continue;
    }
    const unresolvedSlotIds = capability.axes
      .filter((axis) => !resolved.has(axisKey(capability.capabilityContract, axis.slotId)))
      .map((axis) => axis.slotId);
    const modelAxes = capability.axes.map((axis) => {
      const asset = resolved.get(axisKey(capability.capabilityContract, axis.slotId));
      return asset
        ? { slotId: axis.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId }
        : { slotId: axis.slotId, expectedContentId: axis.contentId };
    });
    try {
      const prepared = await input.loadouts.prepare({
        ...((draftLoadoutIds.get(capability.capabilityContract) ?? capability.existingLoadoutId)
          ? { loadoutId: draftLoadoutIds.get(capability.capabilityContract) ?? capability.existingLoadoutId }
          : {}),
        capabilityContract: capability.capabilityContract,
        recipeId: capability.recipeId,
        options: source.loadout.options,
        supportedFeatures: source.implementation?.supportedFeatures ?? [],
        modelAxes,
        displayName: `${input.plan.profile.title} · ${capability.recipe.title}`,
        provenance: { source_profile_id: input.plan.profile.profileId },
      });
      const loadout = await input.loadouts.commit(
        prepared.prepareId,
        prepared.impact?.confirmationRequired === true && input.confirmedMachineImpact === true,
      );
      results.push(Object.freeze({
        capabilityContract: capability.capabilityContract,
        state: 'committed' as const,
        loadout,
        unresolvedSlotIds: Object.freeze(unresolvedSlotIds),
        ...(unresolvedSlotIds.length > 0 ? { reasonCode: firstAxisReason(capability, failures) } : {}),
      }));
    } catch (error) {
      results.push(Object.freeze({
        capabilityContract: capability.capabilityContract,
        state: 'failed' as const,
        ...(draftLoadouts.get(capability.capabilityContract)
          ? { loadout: draftLoadouts.get(capability.capabilityContract) }
          : {}),
        unresolvedSlotIds: Object.freeze(unresolvedSlotIds),
        reasonCode: 'AI_PROFILE_LOADOUT_COMMIT_FAILED',
        detail: errorMessage(error),
      }));
    }
  }
  let appAIConfigApplied = false;
  try {
    await input.applyAIProfile(input.plan.profile);
    appAIConfigApplied = true;
  } catch (error) {
    results.push(Object.freeze({
      capabilityContract: 'AIConfig',
      state: 'failed' as const,
      unresolvedSlotIds: Object.freeze([]),
      reasonCode: 'AI_PROFILE_APPLY_FAILED',
      detail: errorMessage(error),
    }));
  }
  return Object.freeze({
    profile: input.plan.profile,
    capabilities: Object.freeze(results),
    installedModelAssetIds: Object.freeze(installedModelAssetIds),
    appAIConfigApplied,
  });
}

export async function selectRuntimeConfigAIProfileLoadouts(input: {
  readonly result: RuntimeConfigAIProfileTransferResult;
  readonly loadouts: Loadouts;
}): Promise<readonly string[]> {
  const selected: string[] = [];
  for (const capability of input.result.capabilities) {
    if (capability.state !== 'committed' || capability.unresolvedSlotIds.length > 0 ||
      !capability.loadout || capability.loadout.validationState !== 'configured') continue;
    await input.loadouts.select(capability.capabilityContract, capability.loadout.loadoutId, true);
    selected.push(capability.loadout.loadoutId);
  }
  return Object.freeze(selected);
}

async function installCatalogTemplate(
  assets: LocalEnvironmentClient,
  templateId: string,
): Promise<NimiRuntimeModelAssetRecord> {
  const plan = await assets.resolveInstallPlan({ templateId });
  return assets.install(plan.planId, { caller: 'core' });
}

async function installRecommendedSource(
  assets: LocalEnvironmentClient,
  axis: RuntimeConfigAIProfileTransferAxis,
): Promise<NimiRuntimeModelAssetRecord> {
  if (!axis.source) throw new Error(`${axis.displayLabel}: no portable source recommendation.`);
  const plan = await assets.resolveInstallPlan({
    source: 'huggingface',
    modelId: axis.source.repo,
    repo: axis.source.repo,
    revision: axis.source.revision,
    capabilities: [axis.capabilityContract],
    entry: axis.source.file,
    files: [axis.source.file],
    hashes: { [axis.source.file]: normalizeHash(axis.expectedHash) },
  });
  return assets.install(plan.planId, { caller: 'core' });
}

function groupRuntimeConfigAIProfileDownloads(
  capabilities: readonly RuntimeConfigAIProfileTransferCapability[],
): readonly RuntimeConfigAIProfileDownloadGroup[] {
  const grouped = new Map<string, RuntimeConfigAIProfileTransferAxis[]>();
  for (const capability of capabilities) {
    for (const axis of capability.axes) {
      const existing = grouped.get(axis.contentId);
      if (existing) existing.push(axis);
      else grouped.set(axis.contentId, [axis]);
    }
  }
  return Object.freeze([...grouped.entries()].flatMap(([contentId, occurrences]) => {
    const sourceOccurrences = occurrences.filter((axis) => axis.source);
    const firstSourceOccurrence = sourceOccurrences[0];
    if (firstSourceOccurrence) {
      for (const occurrence of sourceOccurrences.slice(1)) {
        if (normalizeHash(firstSourceOccurrence.expectedHash) !== normalizeHash(occurrence.expectedHash)
          || portableSourceIdentity(firstSourceOccurrence.source) !== portableSourceIdentity(occurrence.source)) {
          throw new Error(`AIProfile content ${contentId} has conflicting acquisition intent.`);
        }
      }
    }
    const acquisitionOccurrences = occurrences.filter((axis) => axis.state === 'download-required');
    const first = acquisitionOccurrences[0];
    if (!first) return [];
    for (const occurrence of acquisitionOccurrences.slice(1)) {
      if (!sameRuntimeConfigAIProfileAcquisitionIntent(first, occurrence)) {
        throw new Error(`AIProfile content ${contentId} has conflicting acquisition intent.`);
      }
    }
    const positiveSizes = new Set(acquisitionOccurrences
      .map((axis) => axis.sizeBytes)
      .filter((size) => Number.isFinite(size) && size > 0));
    if (positiveSizes.size > 1) {
      throw new Error(`AIProfile content ${contentId} has conflicting acquisition size facts.`);
    }
    const sizeBytes = acquisitionOccurrences.every((axis) => Number.isFinite(axis.sizeBytes) && axis.sizeBytes > 0)
      ? acquisitionOccurrences[0]!.sizeBytes
      : 0;
    return [Object.freeze({
      contentId,
      representative: Object.freeze({ ...first, sizeBytes }),
      acquisitionOccurrences: Object.freeze([...acquisitionOccurrences]),
      occurrences: Object.freeze([...occurrences]),
    })];
  }));
}

function sameRuntimeConfigAIProfileAcquisitionIntent(
  left: RuntimeConfigAIProfileTransferAxis,
  right: RuntimeConfigAIProfileTransferAxis,
): boolean {
  const leftTemplateId = textFact(left.templateId);
  const rightTemplateId = textFact(right.templateId);
  if (leftTemplateId || rightTemplateId) return leftTemplateId === rightTemplateId;
  return normalizeHash(left.expectedHash) === normalizeHash(right.expectedHash)
    && portableSourceIdentity(left.source) === portableSourceIdentity(right.source);
}

function portableSourceIdentity(source: NimiPortableAIProfileLoadoutAxis['source']): string {
  if (!source) return '';
  return JSON.stringify([
    source.repo.trim(),
    source.revision.trim(),
    source.file.trim(),
  ]);
}

function verifyInstalledAxis(asset: NimiRuntimeModelAssetRecord, axis: RuntimeConfigAIProfileTransferAxis): void {
  if (asset.contentId !== axis.contentId) {
    throw runtimeConfigAIProfileHashMismatch(
      `${axis.displayLabel}: downloaded content identity does not match the AIProfile.`,
    );
  }
  if (!matchesExpectedAxisIntegrity(asset, axis)) {
    throw runtimeConfigAIProfileHashMismatch(
      `${axis.displayLabel}: downloaded content hash does not match the AIProfile.`,
    );
  }
}

function matchesExpectedAxisIntegrity(
  asset: NimiRuntimeModelAssetRecord,
  axis: Pick<RuntimeConfigAIProfileTransferAxis, 'expectedHash' | 'source'>,
): boolean {
  const expectedFile = normalizeRelativeFile(axis.source?.file ?? asset.entry);
  if (!expectedFile) return false;
  const expected = asset.files.find((file) => normalizeRelativeFile(file.relativePath) === expectedFile);
  return expected !== undefined
    && `sha256:${normalizeHash(expected.sha256)}` === axis.expectedHash;
}

function firstAxisReason(
  capability: RuntimeConfigAIProfileTransferCapability,
  failures: ReadonlyMap<string, { readonly reasonCode: string }>,
): string | undefined {
  for (const axis of capability.axes) {
    const failure = failures.get(axisKey(capability.capabilityContract, axis.slotId));
    if (failure) return failure.reasonCode;
    if (axis.reasonCode) return axis.reasonCode;
  }
  return undefined;
}

function axisKey(capabilityContract: string, slotId: string): string {
  return `${capabilityContract}\u0000${slotId}`;
}

function sameImplementation(
  recipe: NimiLoadoutRecipe,
  profile: Extract<NimiPortableAIProfile['capabilities'][string], { readonly route: 'local' }>['implementation'],
): boolean {
  return profile !== undefined &&
    recipe.implementation.implementationId === profile.implementationId &&
    recipe.implementation.driverId === profile.driverId &&
    recipe.implementation.driverDialect === profile.driverDialect &&
    sameFeatureSet(recipe.supportedFeatures, profile.supportedFeatures);
}

function sameFeatureSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((feature, index) => feature === normalizedRight[index]);
}

function verifiedDescriptorForPortableSource(
  source: NonNullable<NimiPortableAIProfileLoadoutAxis['source']>,
  expectedHash: string,
  expectedContentId: string,
  descriptors: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  preferredTemplateId?: string,
): NimiRuntimeLocalVerifiedAssetDescriptor | undefined {
  const repo = source.repo.trim().toLowerCase();
  const revision = source.revision.trim();
  const file = normalizeRelativeFile(source.file);
  const fileHash = normalizeHash(expectedHash);
  const contentId = normalizeHash(expectedContentId);
  const matches = (descriptor: NimiRuntimeLocalVerifiedAssetDescriptor): boolean => {
    const declaredFile = descriptor.files.find((relativePath) => normalizeRelativeFile(relativePath) === file);
    if (!declaredFile) return false;
    const declaredHash = Object.entries(descriptor.hashes)
      .find(([relativePath]) => normalizeRelativeFile(relativePath) === file)?.[1];
    return String(descriptor.repo ?? '').trim().toLowerCase() === repo &&
      String(descriptor.revision ?? '').trim() === revision &&
      normalizeHash(declaredHash ?? '') === fileHash &&
      normalizeHash(descriptor.contentId) === contentId;
  };
  const preferred = preferredTemplateId
    ? descriptors.find((descriptor) => descriptor.templateId === preferredTemplateId)
    : undefined;
  if (preferred && matches(preferred)) return preferred;
  return descriptors.find(matches);
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/u, '');
}

function normalizeRelativeFile(value: string): string {
  return value.trim().replaceAll('\\', '/');
}

function exactSHA256(value: string, label: string): `sha256:${string}` {
  const hash = normalizeHash(value);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(`${label} has no exact SHA-256.`);
  return `sha256:${hash}`;
}

function textFact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function portableJsonObject(value: Readonly<Record<string, unknown>>): NimiJsonObject {
  return JSON.parse(JSON.stringify(value)) as NimiJsonObject;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown AIProfile transfer error');
}

function runtimeConfigAIProfileAcquisitionReasonCode(error: unknown): string {
  const reasonCode = isNimiErrorLike(error) ? error.reasonCode : '';
  return reasonCode === 'AI_LOCAL_DOWNLOAD_HASH_MISMATCH'
    || reasonCode === 'AI_PROFILE_MODEL_HASH_MISMATCH'
    ? 'AI_PROFILE_MODEL_HASH_MISMATCH'
    : 'AI_PROFILE_MODEL_ACQUISITION_FAILED';
}

function runtimeConfigAIProfileHashMismatch(message: string): Error {
  return createNimiError({
    message,
    reasonCode: 'AI_PROFILE_MODEL_HASH_MISMATCH',
    actionHint: 'check_profile_model_integrity',
    source: 'sdk',
  });
}
