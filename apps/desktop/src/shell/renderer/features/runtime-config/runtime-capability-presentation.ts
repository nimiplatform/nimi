import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  AudioLines,
  AudioWaveform,
  FileSearch,
  Image,
  Languages,
  MessageSquare,
  Mic,
  Music2,
  ScanFace,
  ScanSearch,
  Video,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { loadoutModelPresentation } from './runtime-config-loadout-model-display.js';
import { loadoutCompositionKey, type RuntimeSetupPreparationPlan } from './runtime-setup-task-runner.js';

export function setupPlanNeedsPreparation(plan: RuntimeSetupPreparationPlan, choices: Readonly<Record<string, string>>): boolean {
  return plan.components.some(item => item.required)
    || plan.acquire.some(item => !item.offer.installedModelAssetId)
    || plan.awaitingChoice.some(item => !item.options.find(option => option.offerRef === choices[item.slotId])?.installedModelAssetId);
}

const CAPABILITY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'text.generate': MessageSquare,
  'image.generate': Image,
  'audio.synthesize': AudioLines,
  'audio.transcribe': Mic,
  'video.generate': Video,
  'music.generate': Music2,
  'music.transcribe': Music2,
  'audio.voice.convert': Music2,
  'voice.create': AudioWaveform,
  'audio.separate': AudioLines,
  'text.annotate': Languages,
  'image.face_swap': ScanFace,
  'video.face_swap': ScanFace,
  'vision.locate': ScanSearch,
  'text.embed': FileSearch,
};

export function capabilityIcon(capability: string): LucideIcon {
  return CAPABILITY_ICONS[capability] ?? WandSparkles;
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
    /(?:\s+(?:text|image|video|music|speech|audio))?\s+(?:generation|synthesis|transcription)$/u,
    '',
  );
  return stripped.trim() || trimmed;
}

/** Display title of the model a setup task works on, or '' when its candidate is not known. */
export function setupTaskModelTitle(
  task: { readonly candidateLoadoutId?: string },
  loadouts: readonly NimiMachineLoadout[],
  recipes: readonly NimiLoadoutRecipe[],
): string {
  const candidate = task.candidateLoadoutId
    ? loadouts.find((item) => item.loadoutId === task.candidateLoadoutId)
    : undefined;
  const title = candidate?.displayName || recipes.find((item) => item.recipeId === candidate?.recipeId)?.title || '';
  return title ? modelDisplayTitle(title) : '';
}

/** Supported-feature ids that a person can act on when choosing a model. */
export const MODEL_FEATURE_LOCALE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'input.image': 'runtimeConfig.product.feature.input-image',
  'input.audio': 'runtimeConfig.product.feature.input-audio',
  'input.mask': 'runtimeConfig.product.feature.input-mask',
});
export function modelFeatureLocaleKeys(features: readonly string[]): readonly string[] {
  return features.map((feature) => MODEL_FEATURE_LOCALE_KEYS[feature]).filter((key): key is string => !!key);
}

export function capabilityModelIdentity(
  loadout: NimiMachineLoadout | undefined,
  recipes: readonly NimiLoadoutRecipe[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[] = [],
) {
  const recipe = recipes.find((item) => item.recipeId === loadout?.recipeId);
  const main =
    loadout?.modelAxes.find((axis) => axis.slotId.startsWith('main.') && axis.modelAssetId) ??
    loadout?.modelAxes.find((axis) => axis.modelAssetId);
  const descriptor = catalog.find((item) => item.contentId === main?.expectedContentId);
  const version = descriptor
    ? loadoutModelPresentation({ title: descriptor.title, variantLabel: descriptor.entry }).quant.technical
    : '';
  const quant = descriptor
    ? loadoutModelPresentation({ title: descriptor.title, variantLabel: descriptor.entry }).quant
    : null;
  return {
    title: recipe?.title ?? loadout?.displayName ?? '',
    /** Title with the capability noun removed, for headings and rails. */
    shortTitle: modelDisplayTitle(recipe?.title ?? loadout?.displayName ?? ''),
    version,
    /** Headline quantization ("Q4") without the technical suffix. */
    versionShort: quant?.short ?? '',
    sizeBytes: descriptor?.totalSizeBytes && descriptor.totalSizeBytes > 0 ? descriptor.totalSizeBytes : null,
    alias: loadout?.displayName ?? '',
    recipe,
    main,
    descriptor,
  };
}

/**
 * Saved configurations the user can tell apart. Loadouts that run exactly the
 * same thing (same recipe, revision, options, model files and name) collapse
 * into one entry, so a pile of leftovers from repeated "enable" or "use this
 * configuration" reads as the single configuration it really is. The entry
 * shown for a group is the selected Loadout when the group holds it,
 * otherwise the oldest one. This is a presentation grouping only; selecting
 * a configuration never deletes another saved configuration.
 */
export function distinctSavedLoadouts(
  loadouts: readonly NimiMachineLoadout[],
  selectedLoadoutId?: string,
): NimiMachineLoadout[] {
  const groups = new Map<string, NimiMachineLoadout>();
  for (const loadout of loadouts) {
    const key = loadoutCompositionKey(loadout);
    const shown = groups.get(key);
    if (!shown) {
      groups.set(key, loadout);
      continue;
    }
    if (shown.loadoutId === selectedLoadoutId) continue;
    if (loadout.loadoutId === selectedLoadoutId || loadout.createdAt < shown.createdAt) groups.set(key, loadout);
  }
  return [...groups.values()];
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
 * True when a preparation plan has nothing left to acquire, install or choose:
 * every required component is present, every acquisition already maps to an
 * installed asset and no slot is waiting on a choice. Only such a plan may be
 * confirmed for use without showing the review screen; any plan that would
 * download, install or ask still goes through the explicit review.
 */
export function setupPlanAllowsDirectUse(plan: RuntimeSetupPreparationPlan): boolean {
  return plan.unavailable.length === 0 && plan.awaitingChoice.length === 0 && !setupPlanNeedsPreparation(plan, {});
}

/**
 * The first supported recipe for the capability whose required model files
 * are all verified on this device, or null. This is a reading aid for the
 * "downloaded but never selected" gap: it never claims readiness, since the
 * capability still has no machine selection and no environment check.
 */
export function capabilityRecommendedRecipeOnDevice(
  capability: string,
  recipes: readonly NimiLoadoutRecipe[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  assets: readonly NimiRuntimeModelAssetRecord[],
): NimiLoadoutRecipe | null {
  return recipes.find((recipe) => {
    if (recipe.capabilityContract !== capability || recipe.applicability !== 'supported') return false;
    const summary = recipeResourceSummary(recipe, catalog, assets);
    return summary.required > 0 && summary.missing === 0;
  }) ?? null;
}

/** Boolean form of {@link capabilityRecommendedRecipeOnDevice} for the rail. */
export function capabilityRecommendedFilesOnDevice(
  capability: string,
  recipes: readonly NimiLoadoutRecipe[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  assets: readonly NimiRuntimeModelAssetRecord[],
): boolean {
  return capabilityRecommendedRecipeOnDevice(capability, recipes, catalog, assets) !== null;
}
