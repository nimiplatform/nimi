// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import type {
  NimiLoadoutRecipe,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetMarketCandidate,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';

export type NimiLoadoutRecipeSlot = NimiLoadoutRecipe['slots'][number];
export type NimiLoadoutRecipeSlotOffer = NimiLoadoutRecipeSlot['offers'][number];

export type LoadoutQuantSemantic =
  | 'spaceSaving'
  | 'lightweight'
  | 'balanced'
  | 'highQuality'
  | 'maxQuality';

export type LoadoutQuantPresentation = {
  /** Technical quantization name as shipped by the catalog, e.g. Q3_K_M / Q8_0 / F16. */
  readonly technical: string;
  /** Headline-friendly short form, e.g. Q3 / Q8 / F16. */
  readonly short: string;
  /** Rough bit-width used for ordering variants; 0 when unknown. */
  readonly tier: number;
  readonly semantic: LoadoutQuantSemantic | null;
};

export type LoadoutModelPresentation = {
  /** Product family line, e.g. "Gemma 4". */
  readonly family: string;
  /** Parameter-scale label, e.g. "2B" / "26B"; empty when not derivable. */
  readonly sizeLabel: string;
  /** Numeric parameter scale in billions used for group ordering. */
  readonly sizeSort: number;
  /** Headline with product naming, e.g. "Gemma 4 2B · Q8". */
  readonly headline: string;
  readonly quant: LoadoutQuantPresentation;
  /** Original catalog label, retained for secondary/detail display. */
  readonly rawLabel: string;
  /** Original label without the quantization annotation, e.g. "gemma-4-e2b-it-local". */
  readonly rawBase: string;
};

const QUANT_IN_PARENS_PATTERN = /\(([^()]+)\)\s*$/u;
const QUANT_TOKEN_PATTERN = /^(Q\d+[A-Z0-9_]*|BF16|F16|F32|FP16|FP32)$/iu;
const QUANT_IN_FILENAME_PATTERN = /(Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|FP16|FP32)/iu;
const SIZE_TOKEN_PATTERN = /^[a-z]?(\d+(?:\.\d+)?)b$/iu;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]+$/iu;

const QUANT_SEMANTIC_BY_TIER: Readonly<Record<number, LoadoutQuantSemantic>> = {
  3: 'spaceSaving',
  4: 'lightweight',
  5: 'balanced',
  6: 'highQuality',
  8: 'maxQuality',
};

function quantTier(technical: string): number {
  const qMatch = /^Q(\d+)/iu.exec(technical);
  if (qMatch) return Number.parseInt(qMatch[1]!, 10);
  const fMatch = /(\d+)$/u.exec(technical);
  if (fMatch && /^(?:BF|F|FP)\d+$/iu.test(technical)) return Number.parseInt(fMatch[1]!, 10);
  return 0;
}

function quantShort(technical: string): string {
  const qMatch = /^(Q\d+)/iu.exec(technical);
  if (qMatch) return qMatch[1]!.toUpperCase();
  return technical.toUpperCase();
}

export function loadoutQuantPresentation(rawQuant: string): LoadoutQuantPresentation {
  const technical = rawQuant.trim();
  if (!technical || !QUANT_TOKEN_PATTERN.test(technical)) {
    return { technical: '', short: '', tier: 0, semantic: null };
  }
  const normalized = technical.toUpperCase();
  const tier = quantTier(normalized);
  return {
    technical: normalized,
    short: quantShort(normalized),
    tier,
    semantic: QUANT_SEMANTIC_BY_TIER[tier] ?? null,
  };
}

function fileBasename(value: string): string {
  const name = value.trim().split('/').pop() ?? '';
  return name.replace(FILE_EXTENSION_PATTERN, '');
}

function extractQuant(title: string, variantLabel: string): LoadoutQuantPresentation {
  const parens = QUANT_IN_PARENS_PATTERN.exec(title);
  if (parens?.[1]) {
    const fromTitle = loadoutQuantPresentation(parens[1]);
    if (fromTitle.technical) return fromTitle;
  }
  const fromFilename = QUANT_IN_FILENAME_PATTERN.exec(fileBasename(variantLabel));
  if (fromFilename?.[1]) return loadoutQuantPresentation(fromFilename[1]);
  return loadoutQuantPresentation('');
}

function capitalizeToken(token: string): string {
  return /^[a-z]/u.test(token) ? `${token[0]!.toUpperCase()}${token.slice(1)}` : token;
}

function prettifyTokens(tokens: readonly string[]): string {
  return tokens.map(capitalizeToken).join(' ');
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r036
export function loadoutModelPresentation(input: {
  readonly title: string;
  readonly variantLabel?: string;
}): LoadoutModelPresentation {
  const rawLabel = input.title.trim() || input.variantLabel?.trim() || '';
  const titleBase = input.title.replace(QUANT_IN_PARENS_PATTERN, (annotation, value: string) => (
    loadoutQuantPresentation(value).technical ? '' : annotation
  )).trim();
  const base = titleBase || fileBasename(input.variantLabel ?? '');
  const quant = extractQuant(input.title, input.variantLabel ?? '');
  const tokens = base.split(/[-_\s]+/u).filter(Boolean);
  const sizeIndex = tokens.findIndex((token) => SIZE_TOKEN_PATTERN.test(token));
  if (sizeIndex > 0) {
    const sizeValue = Number.parseFloat(SIZE_TOKEN_PATTERN.exec(tokens[sizeIndex]!)![1]!);
    const family = prettifyTokens(tokens.slice(0, sizeIndex)) || base;
    const sizeLabel = `${SIZE_TOKEN_PATTERN.exec(tokens[sizeIndex]!)![1]!}B`;
    const headline = quant.short ? `${family} ${sizeLabel} · ${quant.short}` : `${family} ${sizeLabel}`;
    return { family, sizeLabel, sizeSort: sizeValue, headline, quant, rawLabel, rawBase: base };
  }
  const family = prettifyTokens(tokens) || rawLabel;
  const headline = quant.short ? `${family} · ${quant.short}` : family;
  return { family, sizeLabel: '', sizeSort: Number.MAX_SAFE_INTEGER, headline, quant, rawLabel, rawBase: base };
}

export function loadoutCandidatePresentation(
  candidate: Pick<NimiRuntimeModelAssetMarketCandidate, 'title' | 'variantLabel'>,
): LoadoutModelPresentation {
  return loadoutModelPresentation({ title: candidate.title, variantLabel: candidate.variantLabel });
}

export type LoadoutModelPresentationGroup<T> = {
  readonly key: string;
  readonly title: string;
  readonly sizeSort: number;
  readonly items: readonly T[];
};

export function groupLoadoutModelPresentations<T>(
  items: readonly T[],
  present: (item: T) => LoadoutModelPresentation,
): readonly LoadoutModelPresentationGroup<T>[] {
  const groups = new Map<string, { title: string; sizeSort: number; items: T[] }>();
  for (const item of items) {
    const presentation = present(item);
    const key = `${presentation.family}|${presentation.sizeLabel}`;
    const title = presentation.sizeLabel ? `${presentation.family} ${presentation.sizeLabel}` : presentation.family;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { title, sizeSort: presentation.sizeSort, items: [item] });
    }
  }
  const orderQuant = (left: T, right: T) => {
    const leftTier = present(left).quant.tier || Number.MAX_SAFE_INTEGER;
    const rightTier = present(right).quant.tier || Number.MAX_SAFE_INTEGER;
    return leftTier - rightTier || present(left).headline.localeCompare(present(right).headline);
  };
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      title: group.title,
      sizeSort: group.sizeSort,
      items: Object.freeze([...group.items].sort(orderQuant)),
    }))
    .sort((left, right) => left.sizeSort - right.sizeSort || left.title.localeCompare(right.title));
}

export type LoadoutSlotOfferPartition = {
  /** Not installed but admitted and installable on this device. */
  readonly installable: readonly NimiLoadoutRecipeSlotOffer[];
  /** Not installable here: host-unsupported or not Runtime-installable. */
  readonly incompatible: readonly NimiLoadoutRecipeSlotOffer[];
};

export function partitionLoadoutSlotOffers(
  offers: readonly NimiLoadoutRecipeSlotOffer[],
): LoadoutSlotOfferPartition {
  const installable: NimiLoadoutRecipeSlotOffer[] = [];
  const incompatible: NimiLoadoutRecipeSlotOffer[] = [];
  for (const offer of offers) {
    if (offer.installedModelAssetId) continue;
    if (offer.applicability !== 'unsupported' && offer.candidate.installable) {
      installable.push(offer);
    } else {
      incompatible.push(offer);
    }
  }
  return { installable, incompatible };
}

export function loadoutSlotOfferForAsset(
  slot: Pick<NimiLoadoutRecipeSlot, 'offers'> | undefined,
  modelAssetId: string,
): NimiLoadoutRecipeSlotOffer | undefined {
  if (!slot || !modelAssetId) return undefined;
  return slot.offers.find((offer) => offer.installedModelAssetId === modelAssetId);
}

const SLOT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'main.gguf': 'runtimeConfig.loadouts.slotLabels.mainModel',
  'main.diffusion': 'runtimeConfig.loadouts.slotLabels.mainModel',
  'companion.mmproj': 'runtimeConfig.loadouts.slotLabels.visionProjector',
  'vision.model': 'runtimeConfig.loadouts.slotLabels.visionModel',
  'embedding.gguf': 'runtimeConfig.loadouts.slotLabels.embeddingModel',
  'tts.model': 'runtimeConfig.loadouts.slotLabels.ttsModel',
  'stt.model': 'runtimeConfig.loadouts.slotLabels.sttModel',
  'voice.model': 'runtimeConfig.loadouts.slotLabels.voiceModel',
  'companion.text-encoder': 'runtimeConfig.loadouts.slotLabels.textEncoder',
  'companion.vae': 'runtimeConfig.loadouts.slotLabels.vae',
};

export function loadoutSlotLabelKey(slotId: string): string | null {
  return SLOT_LABEL_KEYS[slotId] ?? null;
}

export function loadoutAssetLabel(
  asset: Pick<NimiRuntimeModelAssetRecord, 'contentId' | 'displayName' | 'entry' | 'modelAssetId'>,
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): string {
  const catalogTitle = verifiedAssets.find((item) => item.contentId === asset.contentId)?.title?.trim();
  return catalogTitle || asset.displayName.trim() || asset.entry.trim() || asset.modelAssetId;
}

/**
 * Runtime recommendations, offers and the current validated binding order the
 * installed choices; they do not exclude other manually selected ModelAssets.
 * Prepare performs the authoritative Model Contract evaluation. The opaque
 * Model Contract and ModelAsset fingerprint are never reinterpreted here.
 */
// @nimi-authority: rule.nimi.runtime.local-compute.r107
export function runtimeConfigLoadoutCandidateAssets(
  slot: (Pick<NimiLoadoutRecipeSlot, 'recommendedContentIds'> & Partial<Pick<NimiLoadoutRecipeSlot, 'offers'>>) | undefined,
  assets: readonly NimiRuntimeModelAssetRecord[],
  currentAxis?: { readonly modelAssetId: string; readonly recipeCompatible: boolean },
): readonly NimiRuntimeModelAssetRecord[] {
  if (!slot) {
    return currentAxis?.recipeCompatible
      ? assets.filter((asset) => asset.modelAssetId === currentAxis.modelAssetId)
      : [];
  }
  const recommendedContentIds = new Set(slot.recommendedContentIds);
  const installedOfferIds = new Set((slot.offers ?? [])
    .filter((offer) => offer.applicability !== 'unsupported' && offer.installedModelAssetId)
    .map((offer) => offer.installedModelAssetId));
  const preferred = (asset: NimiRuntimeModelAssetRecord) => (
    recommendedContentIds.has(asset.contentId)
    || installedOfferIds.has(asset.modelAssetId)
    || (currentAxis?.recipeCompatible === true && asset.modelAssetId === currentAxis.modelAssetId)
  );
  return [...assets.filter(preferred), ...assets.filter((asset) => !preferred(asset))];
}
