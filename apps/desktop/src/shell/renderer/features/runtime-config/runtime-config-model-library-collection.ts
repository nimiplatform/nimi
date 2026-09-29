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
// identity, the catalog logical model id, and recipe slots (their offers, this
// host's recommendations, and which slots a setup requires). Categories aid
// discovery and never assert compatibility.

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

/** Another collection item a setup needs, with the exact versions its slot offers. */
export type NimiCollectionRequiredItem = {
  readonly key: string;
  readonly versions: readonly NimiCollectionVersion[];
};

/** What setting up one capability with this model also prepares. */
export type NimiCollectionRequirement = {
  readonly capability: string;
  readonly items: readonly NimiCollectionRequiredItem[];
};

export type NimiCollectionItem = {
  readonly key: string;
  readonly kind: 'model' | 'part';
  /** This host's Runtime recommends one of its versions. */
  readonly recommended: boolean;
  /**
   * Model only: per capability, the other items every recipe for it requires.
   * A capability whose required slots cannot each be named is left out.
   */
  readonly requirements: readonly NimiCollectionRequirement[];
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

/** Content identity of a catalog variant; a template without one stands alone. */
function contentKeyOf(descriptor: NimiRuntimeLocalVerifiedAssetDescriptor): string {
  return descriptor.contentId || descriptor.templateId;
}

/** Smallest quantization first, then smallest download. */
function sortVersions(versions: NimiCollectionVersion[]): NimiCollectionVersion[] {
  return versions.sort(
    (left, right) => (left.quantTier || Number.MAX_SAFE_INTEGER) - (right.quantTier || Number.MAX_SAFE_INTEGER)
      || left.sizeBytes - right.sizeBytes,
  );
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

  const recommendedTemplates = new Set(input.recipes.flatMap((recipe) => recipe.slots.flatMap((slot) => slot.recommendedVariantIds)));
  const descriptorByTemplate = new Map(input.catalog.map((descriptor) => [descriptor.templateId, descriptor]));
  const descriptorsByVariant = new Map<string, NimiRuntimeLocalVerifiedAssetDescriptor[]>();
  for (const descriptor of input.catalog) {
    const key = variantKey(descriptor.title, descriptor.entry);
    descriptorsByVariant.set(key, [...(descriptorsByVariant.get(key) ?? []), descriptor]);
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
      ? `part:${contentKeyOf(descriptor)}`
      : descriptor.logicalModelId ? `model:${descriptor.logicalModelId}` : `template:${descriptor.templateId}`;
    const draft: Draft = drafts.get(key) ?? { kind: part ? 'part' : 'model', first: descriptor, references: [], versions: new Map() };
    for (const reference of references) {
      if (!draft.references.some((known) => known.recipe.recipeId === reference.recipe.recipeId && known.slot.slotId === reference.slot.slotId)) {
        draft.references.push(reference);
      }
    }
    const contentKey = contentKeyOf(descriptor);
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

  // Each content belongs to one item; requirements point at that item and version.
  const holderByContent = new Map<string, { readonly key: string; readonly version: NimiCollectionVersion }>();
  for (const [key, draft] of drafts) {
    for (const [contentKey, version] of draft.versions) {
      if (!holderByContent.has(contentKey)) holderByContent.set(contentKey, { key, version });
    }
  }
  /** Catalog contents a slot offers or recommends; null when one of them is not in the catalog. */
  const slotContents = (slot: RecipeSlot): string[] | null => {
    const contents = new Set<string>();
    for (const templateId of slot.recommendedVariantIds) {
      const descriptor = descriptorByTemplate.get(templateId);
      if (!descriptor) return null;
      contents.add(contentKeyOf(descriptor));
    }
    for (const offer of slot.offers) {
      const matches = descriptorsByVariant.get(variantKey(offer.candidate.title, offer.candidate.variantLabel)) ?? [];
      if (matches.length === 0) return null;
      for (const descriptor of matches) contents.add(contentKeyOf(descriptor));
    }
    return [...contents];
  };
  /** Items the recipe's other required slots need; null when a slot cannot be named as exactly one item. */
  const requiredItems = (recipe: NimiLoadoutRecipe, ownSlots: ReadonlySet<string>, self: string) => {
    const needed = new Map<string, Set<NimiCollectionVersion>>();
    for (const slot of recipe.slots) {
      if (ownSlots.has(slot.slotId) || slot.presence !== 'required') continue;
      const holders = (slotContents(slot) ?? []).map((content) => holderByContent.get(content));
      const keys = new Set(holders.map((holder) => holder?.key));
      const [key] = keys;
      if (holders.length === 0 || keys.size !== 1 || !key) return null;
      if (key === self) continue;
      const versions = needed.get(key) ?? new Set<NimiCollectionVersion>();
      for (const holder of holders) versions.add(holder!.version);
      needed.set(key, versions);
    }
    return needed;
  };
  // Every recipe that uses the model for a capability must need an item before
  // the capability claims it; one unnamed slot drops the whole capability.
  const requirementsOf = (key: string, draft: Draft): NimiCollectionRequirement[] => {
    const capabilities = draft.first.capabilities ?? [];
    const ownSlots = new Map<string, { readonly recipe: NimiLoadoutRecipe; readonly slots: Set<string> }>();
    for (const reference of draft.references) {
      if (!usesAsModel(reference, capabilities)) continue;
      const entry = ownSlots.get(reference.recipe.recipeId) ?? { recipe: reference.recipe, slots: new Set<string>() };
      entry.slots.add(reference.slot.slotId);
      ownSlots.set(reference.recipe.recipeId, entry);
    }
    return capabilities.flatMap((capability): NimiCollectionRequirement[] => {
      const perRecipe = [...ownSlots.values()]
        .filter((entry) => entry.recipe.capabilityContract === capability)
        .map((entry) => requiredItems(entry.recipe, entry.slots, key));
      const [first, ...rest] = perRecipe;
      if (!first || rest.some((needed) => needed === null)) return [];
      const items = [...first]
        .filter(([itemKey]) => rest.every((needed) => needed!.has(itemKey)))
        .map(([itemKey, versions]): NimiCollectionRequiredItem => ({
          key: itemKey,
          versions: sortVersions([...new Set([...versions, ...rest.flatMap((needed) => [...needed!.get(itemKey)!])])]),
        }));
      return items.length > 0 ? [{ capability, items }] : [];
    });
  };

  const items: NimiCollectionItem[] = [];
  for (const [key, draft] of drafts) {
    const { first } = draft;
    const versions = sortVersions([...draft.versions.values()]);
    const shared = {
      key,
      recommended: versions.some((version) => version.templateIds.some((templateId) => recommendedTemplates.has(templateId))),
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
        requirements: requirementsOf(key, draft),
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
      requirements: [],
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
  // Within a capability, the models this host's Runtime recommends lead.
  const order = (left: NimiCollectionItem, right: NimiCollectionItem) => (
    CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category]
    || left.capability.localeCompare(right.capability)
    || Number(right.recommended) - Number(left.recommended)
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

/** Items grouped by a key; groups follow the first item of each in collection order. */
export function groupNimiCollectionItems<K extends string>(
  items: readonly NimiCollectionItem[],
  keyOf: (item: NimiCollectionItem) => K,
): { readonly key: K; readonly items: readonly NimiCollectionItem[] }[] {
  const groups = new Map<K, NimiCollectionItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, grouped]) => ({ key, items: grouped }));
}

/**
 * Up to `limit` items that show the range of a list: each category in turn
 * under All, otherwise each capability in turn, taking every group's items in
 * collection order so recommended models come first.
 */
export function nimiCollectionPreview(
  items: readonly NimiCollectionItem[],
  category: ModelLibraryCategory,
  limit: number,
): NimiCollectionItem[] {
  const groups = groupNimiCollectionItems(items, (item) => (category === 'all' ? item.category : item.capability));
  const preview: NimiCollectionItem[] = [];
  for (let round = 0; preview.length < limit && groups.some((group) => group.items.length > round); round += 1) {
    for (const group of groups) {
      const item = group.items[round];
      if (item && preview.length < limit) preview.push(item);
    }
  }
  return preview;
}

/** Content ids whose files are on this device and match their registered content. */
export function onDeviceContentIds(assets: readonly NimiRuntimeModelAssetRecord[]): ReadonlySet<string> {
  return new Set(assets.filter((asset) => asset.contentVerified).map((asset) => asset.contentId));
}

export function nimiCollectionSizeRange(item: Pick<NimiCollectionItem, 'versions'>): { readonly min: number; readonly max: number } {
  const sizes = item.versions.map((version) => version.sizeBytes).filter((size) => size > 0);
  return sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : { min: 0, max: 0 };
}
