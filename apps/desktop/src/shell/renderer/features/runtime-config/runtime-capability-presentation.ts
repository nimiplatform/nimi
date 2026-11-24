import type {
  NimiLoadoutRecipe,
  NimiLoadoutRecipeContextFit,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  deriveLoadoutDefaultDisplayName,
  isGenericEngineRecipeTitle,
  loadoutModelPresentation,
  resolvePrimaryRecipeSlot,
  resolveVerifiedAssetIdentity,
} from './runtime-config-loadout-model-display.js';
export {
  deriveLoadoutDefaultDisplayName,
  isGenericEngineRecipeTitle,
  resolvePrimaryRecipeSlot,
  resolveVerifiedAssetIdentity,
} from './runtime-config-loadout-model-display.js';
import {
  runtimeSetupContextApplication,
  runtimeSetupPlanContextFit,
  type RuntimeSetupPreparationPlan,
} from './runtime-setup-task-runner.js';

export function setupPlanNeedsPreparation(plan: RuntimeSetupPreparationPlan, choices: Readonly<Record<string, string>>): boolean {
  return plan.components.some(item => item.required)
    || plan.acquire.some(item => !item.offer.installedModelAssetId)
    || plan.awaitingChoice.some(item => !item.options.find(option => option.offerRef === choices[item.slotId])?.installedModelAssetId);
}

/**
 * Presentation grouping of capability contracts for the workspace rail. This
 * is a reading aid only: unknown contracts fall into the last group and no
 * capability semantics are derived from it.
 */
export type CapabilityGroup = 'text' | 'visual' | 'audio' | 'other';
const CAPABILITY_GROUP_ORDER: readonly CapabilityGroup[] = ['text', 'visual', 'audio', 'other'];
export function capabilityGroup(capability: string): CapabilityGroup {
  const [family] = capability.split('.');
  if (family === 'text') return 'text';
  if (family === 'image' || family === 'video' || family === 'vision') return 'visual';
  if (family === 'audio' || family === 'voice' || family === 'music') return 'audio';
  return 'other';
}
export function groupCapabilities(capabilities: readonly string[]): readonly { group: CapabilityGroup; items: readonly string[] }[] {
  return CAPABILITY_GROUP_ORDER
    .map((group) => ({ group, items: capabilities.filter((item) => capabilityGroup(item) === group) }))
    .filter((entry) => entry.items.length > 0);
}

/**
 * Display title for a recipe or loadout: the capability page already says
 * "image generation", so the trailing capability noun of a catalog title
 * ("Z-Image Turbo generation", "Gemma 4 text generation") is dropped. Engine
 * tags such as "audio.cpp" are kept because they distinguish real variants.
 */
export function modelDisplayTitle(title: string): string {
  const trimmed = title.trim();
  // The modality word is only dropped when the catalog wrote it in lowercase
  // ("Gemma 4 text generation"); a capitalized one is part of the name
  // ("Qwen Image generation" stays "Qwen Image").
  const stripped = trimmed.replace(
    /(?:\s+(?:text|image|video|music|speech|audio))?\s+(?:generation|synthesis|transcription|upscaling)$/u,
    '',
  );
  return stripped.trim() || trimmed;
}

/** Identity-tile seed shared by every variant of one model family, so a family keeps its colour everywhere. */
export function modelFamilySeed(title: string): string {
  return modelDisplayTitle(title).split(/[\s\-_/]+/u)[0]?.toLowerCase() ?? title;
}

/** Display title of the model a setup task works on, or '' when its candidate is not known. */
export function setupTaskModelTitle(
  task: { readonly candidateLoadoutId?: string },
  loadouts: readonly NimiMachineLoadout[],
  recipes: readonly NimiLoadoutRecipe[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[] = [],
  assets: readonly NimiRuntimeModelAssetRecord[] = [],
): string {
  const candidate = task.candidateLoadoutId
    ? loadouts.find((item) => item.loadoutId === task.candidateLoadoutId)
    : undefined;
  if (candidate) {
    const identity = capabilityModelIdentity(candidate, recipes, catalog, assets);
    if (identity.shortTitle) return identity.shortTitle;
  }
  const title = candidate?.displayName || recipes.find((item) => item.recipeId === candidate?.recipeId)?.title || '';
  return title ? modelDisplayTitle(title) : '';
}

/** Supported-feature ids that a person can act on when choosing a model. */
export const MODEL_FEATURE_LOCALE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'input.image': 'runtimeConfig.product.feature.input-image',
  'input.audio': 'runtimeConfig.product.feature.input-audio',
  'input.mask': 'runtimeConfig.product.feature.input-mask',
});
export function modelFeatureLocaleKeys(features: readonly string[] | undefined = []): readonly string[] {
  return (features ?? []).map((feature) => MODEL_FEATURE_LOCALE_KEYS[feature]).filter((key): key is string => !!key);
}

export function capabilityModelIdentity(
  loadout: NimiMachineLoadout | undefined,
  recipes: readonly NimiLoadoutRecipe[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[] = [],
  assets: readonly NimiRuntimeModelAssetRecord[] = [],
) {
  const recipe = recipes.find((item) => item.recipeId === loadout?.recipeId);
  const recipeTitle = recipe?.title ?? '';
  const recipeShortTitle = recipeTitle ? modelDisplayTitle(recipeTitle) : '';
  const primary = resolvePrimaryRecipeSlot(recipe);
  const main = primary.kind === 'single'
    ? loadout?.modelAxes.find((axis) => axis.slotId === primary.slot.slotId && axis.modelAssetId)
    : primary.kind === 'none'
      ? (loadout?.modelAxes.find((axis) => axis.slotId.startsWith('main.') && axis.modelAssetId)
        ?? loadout?.modelAxes.find((axis) => !axis.slotId.startsWith('companion.') && axis.modelAssetId))
      : undefined;
  const asset = main ? assets.find((item) => item.modelAssetId === main.modelAssetId) : undefined;
  const resolved = main ? resolveVerifiedAssetIdentity(asset, main.expectedContentId, catalog) : null;
  const presentation = resolved?.title
    ? loadoutModelPresentation({ title: resolved.title, variantLabel: resolved.variantLabel })
    : null;
  const modelBase = presentation
    ? (presentation.sizeLabel ? `${presentation.family} ${presentation.sizeLabel}` : presentation.family)
    : '';
  const fallbackTitle = primary.kind === 'composite'
    ? (loadout?.displayName || recipeTitle)
    : (recipeTitle || loadout?.displayName || '');
  const shortTitle = modelBase || modelDisplayTitle(fallbackTitle);
  const unbound = Boolean(primary.kind === 'single' && loadout && !main);
  return {
    title: recipeTitle || loadout?.displayName || '',
    /** Model-first title for headings, cards, and rails. */
    shortTitle,
    /** Secondary engine contract label, distinct from shortTitle. */
    recipeShortTitle: recipeShortTitle && recipeShortTitle !== shortTitle ? recipeShortTitle : '',
    /** Seed derived from the actual model family so icons match the model. */
    seed: modelFamilySeed(shortTitle || recipeShortTitle || loadout?.displayName || ''),
    version: presentation?.quant.technical ?? '',
    /** Headline quantization ("Q4") without the technical suffix. */
    versionShort: presentation?.quant.short ?? '',
    sizeBytes: resolved?.sizeBytes ?? null,
    entryPath: asset?.entry || resolved?.descriptor?.entry || '',
    alias: loadout?.displayName ?? '',
    unbound,
    composite: primary.kind === 'composite',
    recipe,
    main,
    asset,
    descriptor: resolved?.descriptor,
  };
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function recipeResourceSummary(
  recipe: NimiLoadoutRecipe,
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  assets: readonly NimiRuntimeModelAssetRecord[],
) {
  const required = recipe.slots.filter((slot) => slot.presence === 'required');
  let ready = 0;
  let missing = 0;
  let bytes = 0;
  let totalBytes = 0;
  let totalKnown = true;
  let known = true;
  const counted = new Set<string>();
  for (const slot of required) {
    if (slot.recommendedContentIds.length !== 1 || slot.recommendedVariantIds.length !== 1) {
      known = false;
      totalKnown = false;
      missing++;
      continue;
    }
    const contentId = slot.recommendedContentIds[0]!;
    const descriptor = catalog.find(
      (item) => item.contentId === contentId && item.templateId === slot.recommendedVariantIds[0],
    );
    if (!counted.has(contentId)) {
      if (descriptor?.totalSizeBytes && descriptor.totalSizeBytes > 0) totalBytes += descriptor.totalSizeBytes;
      else totalKnown = false;
    }
    if (assets.some((asset) => asset.contentId === contentId && asset.contentVerified)) {
      ready++;
      counted.add(contentId);
      continue;
    }
    if (counted.has(contentId)) continue;
    counted.add(contentId);
    missing++;
    if (descriptor?.totalSizeBytes && descriptor.totalSizeBytes > 0) bytes += descriptor.totalSizeBytes;
    else known = false;
  }
  return { ready, missing, required: required.length, bytes: known ? bytes : null, totalBytes: totalKnown ? totalBytes : null };
}

/**
 * Runtime-projected acquisition facts for a recipe's required model slots.
 * A slot counts as installed only when Runtime reports the exact installed
 * distribution on its offer; matching content bytes alone never do. The
 * Use source transfer bytes when the required work identifies a single offer.
 * A version chosen during review may have a different transfer size.
 */
export type RecipeOfferSummary = {
  readonly required: number;
  readonly installed: number;
  readonly missing: number;
  /** Required slots without any installable or installed offer for this device. */
  readonly withoutOffer: number;
  readonly downloadBytes: number | null;
  readonly downloadVariesByVersion: boolean;
};

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function recipeOfferSummary(
  recipe: NimiLoadoutRecipe,
  catalog?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  assets: readonly NimiRuntimeModelAssetRecord[] = [],
): RecipeOfferSummary {
  const required = recipe.slots.filter((slot) => slot.presence === 'required');
  let installed = 0;
  let missing = 0;
  let withoutOffer = 0;
  let downloadBytes: number | null = 0;
  let downloadVariesByVersion = false;
  const counted = new Set<string>();
  for (const slot of required) {
    const exact = catalog && exactRecommendedSlotOffer(slot, catalog, assets);
    const usable = exact ? (exact.offer ? [exact.offer] : []) : slot.offers.filter((offer) => offer.applicability !== 'unsupported');
    if (usable.some((offer) => offer.installedModelAssetId)) {
      installed++;
      continue;
    }
    const installable = usable.filter((offer) => offer.candidate.installable);
    const candidate = installable[0]?.candidate;
    if (!candidate) {
      withoutOffer++;
      continue;
    }
    missing++;
    if (installable.length > 1) {
      downloadVariesByVersion = true;
      downloadBytes = null;
      continue;
    }
    if (counted.has(candidate.offerRef)) continue;
    counted.add(candidate.offerRef);
    const transfer = candidate.downloadSizeBytes;
    downloadBytes = downloadBytes !== null && transfer !== undefined && transfer > 0 ? downloadBytes + transfer : null;
  }
  return { required: required.length, installed, missing, withoutOffer, downloadBytes, downloadVariesByVersion };
}

/** A context size the way model capacity is usually read: 262144 is "256K". */
export function formatContextTokens(tokens: number): string {
  return tokens > 0 && tokens % 1024 === 0 ? `${tokens / 1024}K` : tokens.toLocaleString();
}

/** True when Runtime recommends less than the model's own context capacity on this device. */
export function contextFitReduced(fit: NimiLoadoutRecipeContextFit): boolean {
  return fit.recommendedContextSize < fit.authoredContextSize;
}

/** Runtime's context fit of a recipe's device recommendation: the one required slot that carries it. */
export function recipeRecommendedContextFit(recipe: NimiLoadoutRecipe): NimiLoadoutRecipeContextFit | undefined {
  const fits = recipe.slots.flatMap((slot) => (
    slot.presence === 'required' && slot.recommendedContextFit ? [slot.recommendedContextFit] : []
  ));
  return fits.length === 1 ? fits[0] : undefined;
}

/**
 * True when a preparation plan has nothing left to acquire, install or choose:
 * every required component is present, every acquisition already maps to an
 * installed asset and no slot is waiting on a choice. Only such a plan may be
 * confirmed for use without showing the review screen; any plan that would
 * download, install or ask still goes through the explicit review, and so
 * does one that would write a reduced context the person has not seen.
 */
export function setupPlanAllowsDirectUse(
  plan: RuntimeSetupPreparationPlan,
  explicitOptions: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const context = runtimeSetupContextApplication(explicitOptions, runtimeSetupPlanContextFit(plan));
  const adoptsReducedContext = context.options !== undefined && context.preview !== undefined
    && context.preview.recommendedContextSize < context.preview.authoredContextSize;
  return plan.unavailable.length === 0 && plan.awaitingChoice.length === 0 && !plan.environmentUnavailable
    && !setupPlanNeedsPreparation(plan, {}) && !adoptsReducedContext;
}

/**
 * Exact Runtime-recommended offer for a single required slot when Runtime has
 * narrowed the device recommendation to one template and content identity.
 */
export function exactRecommendedSlotOffer(
  slot: NimiLoadoutRecipe['slots'][number],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[] = [],
  assets: readonly NimiRuntimeModelAssetRecord[] = [],
) {
  if (slot.recommendedVariantIds.length !== 1 || slot.recommendedContentIds.length !== 1) return undefined;
  const templateId = slot.recommendedVariantIds[0]!;
  const contentId = slot.recommendedContentIds[0]!;
  const descriptor = catalog.find((item) => item.templateId === templateId && item.contentId === contentId);
  const installed = assets.filter(asset => asset.contentVerified && asset.contentId === contentId);
  const offer = slot.offers.find(item => item.applicability !== 'unsupported'
    && descriptor && item.candidate.title === descriptor.title && item.candidate.variantLabel === descriptor.entry
    && (item.installedModelAssetId
      ? installed.some(asset => asset.modelAssetId === item.installedModelAssetId)
      : item.candidate.installable));
  const installedAsset = installed.find(asset => asset.modelAssetId === offer?.installedModelAssetId);
  return { templateId, contentId, descriptor, installedAsset, offer };
}

/**
 * The first supported recipe for the capability whose exact recommended model
 * files are installed on this device, or null. When Runtime narrows a required
 * slot to a single recommended contentId, another installed quantization of
 * the same slot does not masquerade as that exact recommendation.
 */
export function capabilityRecommendedRecipeOnDevice(
  capability: string,
  recipes: readonly NimiLoadoutRecipe[],
  assets?: readonly NimiRuntimeModelAssetRecord[],
  catalog?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): NimiLoadoutRecipe | null {
  return recipes.find((recipe) => {
    if (recipe.capabilityContract !== capability || recipe.applicability !== 'supported') return false;
    const required = recipe.slots.filter((slot) => slot.presence === 'required');
    if (required.length === 0) return false;
    return required.every((slot) => {
      const exact = catalog && exactRecommendedSlotOffer(slot, catalog, assets);
      if (exact) return Boolean(exact.installedAsset);
      if (slot.recommendedContentIds.length === 1 && assets) {
        const expectedContentId = slot.recommendedContentIds[0]!;
        return assets.some((asset) => asset.contentId === expectedContentId && asset.contentVerified);
      }
      return slot.offers.some((offer) => offer.applicability !== 'unsupported' && Boolean(offer.installedModelAssetId));
    });
  }) ?? null;
}

/** Boolean form of {@link capabilityRecommendedRecipeOnDevice} for the rail. */
export function capabilityRecommendedFilesOnDevice(
  capability: string,
  recipes: readonly NimiLoadoutRecipe[],
  assets?: readonly NimiRuntimeModelAssetRecord[],
  catalog?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): boolean {
  return capabilityRecommendedRecipeOnDevice(capability, recipes, assets, catalog) !== null;
}
