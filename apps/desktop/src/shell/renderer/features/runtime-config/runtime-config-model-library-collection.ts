import type {
  NimiLoadoutRecipe,
  NimiRuntimeFeaturedModelAssets,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { loadoutModelPresentation, loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import { modelDisplayTitle, modelFamilySeed } from './runtime-capability-presentation.js';

// Projection of the Runtime verified catalog ("Nimi 收录") for Model Library
// discovery. It only reads Runtime facts: catalog capabilities and content
// identity, the catalog logical model id, and recipe slot recommendations.
// Categories aid discovery and never assert compatibility.

export const MODEL_LIBRARY_CATEGORIES = ['all', 'chat', 'image', 'video', 'voice', 'music', 'other'] as const;
export type ModelLibraryCategory = typeof MODEL_LIBRARY_CATEGORIES[number];
export type ModelLibraryItemCategory = Exclude<ModelLibraryCategory, 'all'>;

/** Categories the community feed serves; Runtime rejects any other featured category. */
export const COMMUNITY_FEED_CATEGORIES = ['chat', 'image', 'video'] as const;
export type CommunityFeedCategory = typeof COMMUNITY_FEED_CATEGORIES[number];

const CATEGORY_BY_CAPABILITY: Readonly<Record<string, ModelLibraryItemCategory>> = Object.freeze({
  'text.generate': 'chat',
  'image.generate': 'image',
  'video.generate': 'video',
  'audio.synthesize': 'voice',
  'audio.transcribe': 'voice',
  'voice.create': 'voice',
  'music.generate': 'music',
  'music.transcribe': 'music',
  'audio.separate': 'music',
  'audio.voice.convert': 'music',
});

const CATEGORY_RANK: Readonly<Record<ModelLibraryItemCategory, number>> = Object.freeze({
  chat: 0,
  image: 1,
  video: 2,
  voice: 3,
  music: 4,
  other: 5,
});

export function modelLibraryCategoryForCapability(capability: string): ModelLibraryItemCategory {
  return CATEGORY_BY_CAPABILITY[capability] ?? 'other';
}

/** A capability deep link opens its category; the Model Library itself opens on everything. */
export function initialModelLibraryCategory(capability?: string): ModelLibraryCategory {
  return capability ? modelLibraryCategoryForCapability(capability) : 'all';
}

export function communityFeedCategories(category: ModelLibraryCategory): readonly CommunityFeedCategory[] {
  if (category === 'all') return COMMUNITY_FEED_CATEGORIES;
  return (COMMUNITY_FEED_CATEGORIES as readonly string[]).includes(category) ? [category as CommunityFeedCategory] : [];
}

/**
 * One community list over several feed categories, in category order. The
 * source counts as available when any feed is, and as stale when any
 * available feed is.
 */
export function mergeCommunityFeeds(feeds: readonly NimiRuntimeFeaturedModelAssets[]): NimiRuntimeFeaturedModelAssets {
  const seen = new Set<string>();
  const items = feeds.flatMap((feed) => feed.items).filter((item) => {
    if (seen.has(item.offerRef)) return false;
    seen.add(item.offerRef);
    return true;
  });
  const available = feeds.filter((feed) => feed.source.availability === 'available');
  const first = available[0] ?? feeds[0];
  if (!first) return { source: { availability: 'unavailable' }, items };
  return {
    source: available.some((feed) => feed.source.freshness === 'stale')
      ? { ...first.source, freshness: 'stale' }
      : first.source,
    items,
  };
}

export type NimiCollectionVersion = {
  /** Content identity of this distribution. */
  readonly contentId: string;
  /** Every catalog template carrying this exact content; any of them installs the same ModelAsset. */
  readonly templateIds: readonly string[];
  /** Headline quantization such as "Q4"; empty when the catalog names none. */
  readonly quantLabel: string;
  readonly quantTier: number;
  readonly sizeBytes: number;
  readonly entry: string;
};

export type NimiCollectionItem = {
  readonly key: string;
  readonly kind: 'model' | 'part';
  /** Model name; empty for a part, which is named by its role instead. */
  readonly title: string;
  /** Part role label key and the catalog's own slot label as fallback. */
  readonly roleLabelKey: string | null;
  readonly roleLabel: string;
  /** Part only: name of the model setup it belongs to. */
  readonly usedBy: string;
  /** Identity-tile seed shared with the model family (a part uses the model it serves). */
  readonly seed: string;
  /** Capability the item is labeled with: a model's first capability, or the one a part serves. */
  readonly capability: string;
  readonly category: ModelLibraryItemCategory;
  readonly repo: string;
  readonly revision: string;
  readonly license: string;
  readonly versions: readonly NimiCollectionVersion[];
};

export type NimiCollection = {
  readonly models: readonly NimiCollectionItem[];
  readonly parts: readonly NimiCollectionItem[];
};

type RecipeSlot = NimiLoadoutRecipe['slots'][number];
type SlotReference = { readonly recipe: NimiLoadoutRecipe; readonly slot: RecipeSlot };

const ROLE_LABEL = 'runtimeConfig.modelLibrary.collection.roles';
const SLOT_LABEL = 'runtimeConfig.loadouts.slotLabels';

/** Part labels for companion slots the shared slot labels leave to the catalog's English label. */
const PART_SLOT_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'companion.uncond-diffusion': `${ROLE_LABEL}.uncondDiffusion`,
  'encoder.h3-combined': `${SLOT_LABEL}.textEncoder`,
  'vae.video': `${ROLE_LABEL}.videoVae`,
  'vae.audio': `${ROLE_LABEL}.audioVae`,
  'stt.vad': `${ROLE_LABEL}.voiceActivity`,
  'stt.aligner': `${ROLE_LABEL}.aligner`,
  'codec.model': `${ROLE_LABEL}.codec`,
});

/** Part labels from the catalog artifact role, for parts no recipe offers. */
const PART_ROLE_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  text_encoder: `${SLOT_LABEL}.textEncoder`,
  mmproj: `${SLOT_LABEL}.visionProjector`,
  vae: `${SLOT_LABEL}.vae`,
  video_vae: `${ROLE_LABEL}.videoVae`,
  audio_vae: `${ROLE_LABEL}.audioVae`,
  uncond_diffusion_model: `${ROLE_LABEL}.uncondDiffusion`,
  silero_vad_model: `${ROLE_LABEL}.voiceActivity`,
  stt_transformers_aligner: `${ROLE_LABEL}.aligner`,
  audio_codec: `${ROLE_LABEL}.codec`,
});

function partRoleLabelKey(
  reference: SlotReference | undefined,
  descriptor: NimiRuntimeLocalVerifiedAssetDescriptor,
): string | null {
  if (reference) {
    return PART_SLOT_LABEL_KEYS[reference.slot.slotId] ?? loadoutSlotLabelKey(reference.slot.slotId);
  }
  const role = descriptor.artifactRoles?.find((item) => PART_ROLE_LABEL_KEYS[item]);
  return role ? PART_ROLE_LABEL_KEYS[role]! : null;
}

/** A companion slot, or a recipe for a capability the asset does not declare, uses it only as a part. */
function usesAsModel(reference: SlotReference, capabilities: readonly string[]): boolean {
  return capabilities.includes(reference.recipe.capabilityContract) && !reference.slot.slotId.startsWith('companion.');
}

/**
 * Name from the catalog id when no recipe names the model. Verified titles
 * read "<id> (<variant>)" and ids read "<name>[-audio-cpp]-local"; the engine
 * tag stays because it tells real variants apart.
 */
function catalogModelName(descriptor: NimiRuntimeLocalVerifiedAssetDescriptor): string {
  const id = descriptor.title.replace(/\s*\([^()]*\)\s*$/u, '').trim();
  const audioCpp = /-audio-cpp(?=-|$)/u.test(id);
  const base = id.replace(/-audio-cpp(?=-|$)/u, '').replace(/-local$/u, '');
  const presentation = loadoutModelPresentation({ title: base, variantLabel: descriptor.entry });
  const name = presentation.sizeLabel ? `${presentation.family} ${presentation.sizeLabel}` : presentation.family;
  return audioCpp ? `${name} audio.cpp` : name;
}

/** Runtime projects each slot offer from the same catalog variant, keeping its title and entry. */
function variantKey(title: string, entry: string): string {
  return `${title.trim()}\u0000${entry.trim()}`;
}

function versionOf(descriptor: NimiRuntimeLocalVerifiedAssetDescriptor): NimiCollectionVersion {
  const quant = loadoutModelPresentation({ title: descriptor.title, variantLabel: descriptor.entry }).quant;
  return {
    contentId: descriptor.contentId,
    templateIds: [descriptor.templateId],
    quantLabel: quant.short,
    quantTier: quant.tier,
    sizeBytes: descriptor.totalSizeBytes ?? 0,
    entry: descriptor.entry,
  };
}

type Draft = {
  readonly kind: 'model' | 'part';
  readonly first: NimiRuntimeLocalVerifiedAssetDescriptor;
  readonly references: SlotReference[];
  readonly versions: Map<string, NimiCollectionVersion>;
};

/**
 * Builds the Nimi collection. Versions that carry the same content collapse
 * into one; model versions are grouped only by the catalog logical model id,
 * never by display or file names. An asset without capabilities, or one that
 * recipes offer only as a companion or for another capability, is a part.
 */
export function buildNimiCollection(input: {
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly recipes: readonly NimiLoadoutRecipe[];
}): NimiCollection {
  // A slot's recommended variants are only this host's recommendation; its
  // offers cover every catalog variant the slot declares.
  const referencesByTemplate = new Map<string, SlotReference[]>();
  const referencesByVariant = new Map<string, SlotReference[]>();
  const remember = (index: Map<string, SlotReference[]>, key: string, reference: SlotReference) => {
    const list = index.get(key) ?? [];
    list.push(reference);
    index.set(key, list);
  };
  for (const recipe of input.recipes) {
    for (const slot of recipe.slots) {
      for (const templateId of slot.recommendedVariantIds) remember(referencesByTemplate, templateId, { recipe, slot });
      for (const offer of slot.offers) {
        remember(referencesByVariant, variantKey(offer.candidate.title, offer.candidate.variantLabel), { recipe, slot });
      }
    }
  }

  const drafts = new Map<string, Draft>();
  for (const descriptor of input.catalog) {
    const capabilities = descriptor.capabilities ?? [];
    const references: SlotReference[] = [];
    for (const reference of [
      ...(referencesByTemplate.get(descriptor.templateId) ?? []),
      ...(referencesByVariant.get(variantKey(descriptor.title, descriptor.entry)) ?? []),
    ]) {
      if (!references.some((known) => known.recipe.recipeId === reference.recipe.recipeId && known.slot.slotId === reference.slot.slotId)) {
        references.push(reference);
      }
    }
    const part = capabilities.length === 0
      || (references.length > 0 && !references.some((reference) => usesAsModel(reference, capabilities)));
    const key = part
      ? `part:${descriptor.contentId || descriptor.templateId}`
      : descriptor.logicalModelId ? `model:${descriptor.logicalModelId}` : `template:${descriptor.templateId}`;
    const draft: Draft = drafts.get(key) ?? { kind: part ? 'part' : 'model', first: descriptor, references: [], versions: new Map() };
    for (const reference of references) {
      if (!draft.references.some((known) => known.recipe.recipeId === reference.recipe.recipeId && known.slot.slotId === reference.slot.slotId)) {
        draft.references.push(reference);
      }
    }
    const contentKey = descriptor.contentId || descriptor.templateId;
    const known = draft.versions.get(contentKey);
    draft.versions.set(contentKey, known
      ? { ...known, templateIds: [...known.templateIds, descriptor.templateId] }
      : versionOf(descriptor));
    drafts.set(key, draft);
  }

  // A recipe names a model only when its model slots offer that one model and
  // its title follows the "<model> <capability noun>" convention.
  const modelsByRecipe = new Map<string, Set<string>>();
  for (const [key, draft] of drafts) {
    if (draft.kind !== 'model') continue;
    for (const reference of draft.references) {
      if (reference.slot.slotId.startsWith('companion.')) continue;
      const models = modelsByRecipe.get(reference.recipe.recipeId) ?? new Set<string>();
      models.add(key);
      modelsByRecipe.set(reference.recipe.recipeId, models);
    }
  }
  const recipeName = new Map<string, string>();
  for (const recipe of input.recipes) {
    const name = modelDisplayTitle(recipe.title);
    if (modelsByRecipe.get(recipe.recipeId)?.size === 1 && name !== recipe.title.trim()) {
      recipeName.set(recipe.recipeId, name);
    }
  }

  const items: NimiCollectionItem[] = [];
  for (const [key, draft] of drafts) {
    const { first } = draft;
    const versions = [...draft.versions.values()].sort(
      (left, right) => (left.quantTier || Number.MAX_SAFE_INTEGER) - (right.quantTier || Number.MAX_SAFE_INTEGER)
        || left.sizeBytes - right.sizeBytes,
    );
    const shared = {
      key,
      repo: first.repo,
      revision: first.revision,
      license: first.license,
      versions,
    };
    if (draft.kind === 'model') {
      const capabilities = first.capabilities ?? [];
      const named = capabilities
        .flatMap((capability) => draft.references.filter((reference) => (
          reference.recipe.capabilityContract === capability && usesAsModel(reference, capabilities)
        )))
        .map((reference) => recipeName.get(reference.recipe.recipeId))
        .find((name): name is string => Boolean(name));
      const title = named ?? catalogModelName(first);
      const capability = capabilities[0] ?? '';
      items.push({
        ...shared,
        kind: 'model',
        title,
        roleLabelKey: null,
        roleLabel: '',
        usedBy: '',
        seed: modelFamilySeed(title),
        capability,
        category: modelLibraryCategoryForCapability(capability),
      });
      continue;
    }
    const reference = draft.references[0];
    const recipeTitle = reference ? modelDisplayTitle(reference.recipe.title) : '';
    // "Gemma 4 26B" says more than the recipe's "Gemma 4" when the catalog id adds only a size.
    const specific = catalogModelName(first);
    const sizeOnly = recipeTitle !== '' && specific.startsWith(`${recipeTitle} `)
      && /^\d+(?:\.\d+)?B$/u.test(specific.slice(recipeTitle.length + 1));
    const usedBy = sizeOnly ? specific : recipeTitle;
    const roleLabel = reference?.slot.displayLabel.trim() || specific;
    const capability = reference?.recipe.capabilityContract ?? '';
    items.push({
      ...shared,
      kind: 'part',
      title: '',
      roleLabelKey: partRoleLabelKey(reference, first),
      roleLabel,
      usedBy,
      seed: modelFamilySeed(usedBy || roleLabel),
      capability,
      category: capability ? modelLibraryCategoryForCapability(capability) : 'other',
    });
  }

  const byName = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true });
  const order = (left: NimiCollectionItem, right: NimiCollectionItem) => (
    CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category]
    || left.capability.localeCompare(right.capability)
    || byName(left.title || left.usedBy, right.title || right.usedBy)
    || byName(left.roleLabel, right.roleLabel)
    || (left.versions[0]?.quantTier ?? 0) - (right.versions[0]?.quantTier ?? 0)
  );
  return {
    models: items.filter((item) => item.kind === 'model').sort(order),
    parts: items.filter((item) => item.kind === 'part').sort(order),
  };
}

export function nimiCollectionForCategory(collection: NimiCollection, category: ModelLibraryCategory): NimiCollection {
  if (category === 'all') return collection;
  return {
    models: collection.models.filter((item) => item.category === category),
    parts: collection.parts.filter((item) => item.category === category),
  };
}

/** Content ids whose files are on this device and match their registered content. */
export function onDeviceContentIds(assets: readonly NimiRuntimeModelAssetRecord[]): ReadonlySet<string> {
  return new Set(assets.filter((asset) => asset.contentVerified).map((asset) => asset.contentId));
}

export function nimiCollectionSizeRange(item: Pick<NimiCollectionItem, 'versions'>): { readonly min: number; readonly max: number } {
  const sizes = item.versions.map((version) => version.sizeBytes).filter((size) => size > 0);
  return sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : { min: 0, max: 0 };
}
