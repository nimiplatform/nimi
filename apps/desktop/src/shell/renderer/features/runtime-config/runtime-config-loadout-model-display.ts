// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
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

const KNOWN_MODEL_TOKEN_CASING: Readonly<Record<string, string>> = Object.freeze({
  sdxl: 'SDXL',
  voxcpm: 'VoxCPM',
  voxcpm2: 'VoxCPM2',
  tts: 'TTS',
  stt: 'STT',
  llm: 'LLM',
  vlm: 'VLM',
  vl: 'VL',
  xl: 'XL',
  dit: 'DiT',
});

function capitalizeToken(token: string): string {
  const known = KNOWN_MODEL_TOKEN_CASING[token.toLowerCase()];
  if (known) return known;
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
  'companion.mmproj': 'runtimeConfig.loadouts.slotLabels.mediaProjector',
  'companion.controlnet': 'runtimeConfig.loadouts.slotLabels.controlnet',
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

const TRAILING_ULID_PATTERN = /(?:[-_\s]+)(?:01|02|00)[0-9A-HJKMNP-TV-Z]{24}$/iu;

/** Display-only normalization that trims an importer-appended trailing ULID suffix. */
export function cleanAssetDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const cleaned = trimmed.replace(TRAILING_ULID_PATTERN, '').trim();
  return cleaned || trimmed;
}

/**
 * Returns the catalog descriptor matching contentId only when the catalog
 * identifies one unambiguous logical model for that content identity (avoiding
 * guessing the first entry when multiple logical models share content bytes).
 */
export function resolveUnambiguousCatalogDescriptor(
  contentId: string | undefined,
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): NimiRuntimeLocalVerifiedAssetDescriptor | undefined {
  const id = contentId?.trim() ?? '';
  if (!id) return undefined;
  const matches = catalog.filter((item) => item.contentId === id);
  if (matches.length === 0) return undefined;
  const distinctModels = new Set(matches.map((item) => item.logicalModelId || item.templateId));
  return distinctModels.size === 1 ? matches[0] : undefined;
}

export type ResolvedVerifiedAssetIdentity = {
  readonly descriptor: NimiRuntimeLocalVerifiedAssetDescriptor | undefined;
  readonly title: string;
  readonly variantLabel: string;
  readonly sizeBytes: number | null;
};

export function resolveVerifiedAssetIdentity(
  asset: Pick<NimiRuntimeModelAssetRecord, 'contentId' | 'displayName' | 'entry' | 'modelAssetId' | 'totalSizeBytes'> | undefined,
  expectedContentId: string | undefined,
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): ResolvedVerifiedAssetIdentity {
  const contentId = asset?.contentId || expectedContentId || '';
  const descriptor = resolveUnambiguousCatalogDescriptor(contentId, catalog);
  if (descriptor) {
    const assetSize = asset?.totalSizeBytes && asset.totalSizeBytes > 0 ? asset.totalSizeBytes : 0;
    const descriptorSize = descriptor.totalSizeBytes && descriptor.totalSizeBytes > 0 ? descriptor.totalSizeBytes : 0;
    const size = assetSize || descriptorSize;
    return {
      descriptor,
      title: descriptor.title.trim() || cleanAssetDisplayName(asset?.displayName || descriptor.entry),
      variantLabel: asset?.entry?.trim() || descriptor.entry,
      sizeBytes: size > 0 ? size : null,
    };
  }
  if (asset) {
    const raw = asset.displayName.trim() || asset.entry.trim() || asset.modelAssetId;
    return {
      descriptor: undefined,
      title: cleanAssetDisplayName(raw),
      variantLabel: asset.entry,
      sizeBytes: asset.totalSizeBytes > 0 ? asset.totalSizeBytes : null,
    };
  }
  return { descriptor: undefined, title: '', variantLabel: '', sizeBytes: null };
}

export function loadoutAssetLabel(
  asset: Pick<NimiRuntimeModelAssetRecord, 'contentId' | 'displayName' | 'entry' | 'modelAssetId'> & { readonly totalSizeBytes?: number },
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): string {
  const resolved = resolveVerifiedAssetIdentity(
    { ...asset, totalSizeBytes: asset.totalSizeBytes ?? 0 },
    asset.contentId,
    verifiedAssets,
  );
  return resolved.title || cleanAssetDisplayName(asset.displayName) || asset.entry.trim() || asset.modelAssetId;
}

export const LOADOUT_DISPLAY_NAME_SOURCE_PROVENANCE_KEY = 'display_name_source';
export type LoadoutDisplayNameSource = 'auto' | 'user' | 'unknown';

export function loadoutDisplayNameSource(
  provenance: Readonly<Record<string, unknown>> | undefined,
): LoadoutDisplayNameSource {
  const value = provenance?.[LOADOUT_DISPLAY_NAME_SOURCE_PROVENANCE_KEY];
  if (value === 'auto' || value === 'user') return value;
  return 'unknown';
}

export type PrimaryRecipeSlotResolution =
  | { readonly kind: 'single'; readonly slot: NimiLoadoutRecipeSlot }
  | { readonly kind: 'composite'; readonly slots: readonly NimiLoadoutRecipeSlot[] }
  | { readonly kind: 'none' };

/**
 * Resolves the primary model slot role of a Recipe before looking up Loadout
 * axis bindings, preventing alphabetical axis order (e.g. companion.text-encoder
 * before main.diffusion in Z-Image) from misidentifying a companion as the model.
 */
export function resolvePrimaryRecipeSlot(
  recipe: Pick<NimiLoadoutRecipe, 'slots'> | undefined,
): PrimaryRecipeSlotResolution {
  const slots = recipe?.slots ?? [];
  if (slots.length === 0) return { kind: 'none' };
  const required = slots.filter((slot) => slot.presence !== 'optional-conditional');
  const mainRequired = required.filter((slot) => slot.slotId.startsWith('main.'));
  if (mainRequired.length === 1) return { kind: 'single', slot: mainRequired[0]! };
  const nonCompanionRequired = required.filter((slot) => !slot.slotId.startsWith('companion.'));
  if (nonCompanionRequired.length === 1) return { kind: 'single', slot: nonCompanionRequired[0]! };
  if (nonCompanionRequired.length > 1) return { kind: 'composite', slots: nonCompanionRequired };
  if (required.length === 1) return { kind: 'single', slot: required[0]! };
  return { kind: 'none' };
}

const GENERIC_ENGINE_TITLE_STOPWORDS = new Set([
  'llama',
  'llama.cpp',
  'llamacpp',
  'gguf',
  'ggml',
  'onnx',
  'safetensors',
  'stable-diffusion.cpp',
  'sd.cpp',
  'audio.cpp',
  'transformers',
  'embeddings',
  'text',
  'image',
  'video',
  'audio',
  'speech',
  'voice',
  'music',
  'model',
]);

function stripTrailingCapabilityNoun(title: string): string {
  const trimmed = title.trim();
  const stripped = trimmed.replace(
    /(?:\s+(?:text|image|video|music|speech|audio))?\s+(?:generation|synthesis|transcription|upscaling)$/u,
    '',
  );
  return stripped.trim() || trimmed;
}

/**
 * True when a Recipe title consists solely of generic engine/format/modality
 * tokens (e.g. "llama.cpp GGUF text generation") and carries no concrete model
 * name of its own.
 */
export function isGenericEngineRecipeTitle(title: string): boolean {
  const short = stripTrailingCapabilityNoun(title);
  const tokens = short
    .split(/\s+/u)
    .map((token) => token.replace(/^[()]+|[()]+$/gu, '').toLowerCase())
    .filter(Boolean);
  return tokens.length === 0 || tokens.every((token) => GENERIC_ENGINE_TITLE_STOPWORDS.has(token));
}

export function deriveLoadoutDefaultDisplayName(
  recipe: Pick<NimiLoadoutRecipe, 'title' | 'slots'>,
  modelAxes: readonly { readonly slotId: string; readonly modelAssetId: string; readonly expectedContentId?: string }[],
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[] = [],
  assets: readonly NimiRuntimeModelAssetRecord[] = [],
  preferredOffers?: Readonly<Record<string, string>>,
): string {
  const primary = resolvePrimaryRecipeSlot(recipe);
  if (primary.kind === 'single') {
    const { slot } = primary;
    const bound = modelAxes.find((axis) => axis.slotId === slot.slotId && axis.modelAssetId);
    if (bound) {
      const asset = assets.find((item) => item.modelAssetId === bound.modelAssetId);
      const offer = slot.offers.find((item) => item.installedModelAssetId === bound.modelAssetId);
      const identity = resolveVerifiedAssetIdentity(asset, bound.expectedContentId, catalog);
      if (identity.title) {
        const headline = loadoutModelPresentation({
          title: identity.title,
          variantLabel: identity.variantLabel,
        }).headline.trim();
        if (headline) return headline;
      }
      if (offer) {
        const headline = loadoutCandidatePresentation(offer.candidate).headline.trim();
        if (headline) return headline;
      }
    }
    const preferredRef = preferredOffers?.[slot.slotId];
    if (preferredRef) {
      const offer = slot.offers.find((item) => item.candidate.offerRef === preferredRef);
      if (offer) {
        const headline = loadoutCandidatePresentation(offer.candidate).headline.trim();
        if (headline) return headline;
      }
    }
  }
  return stripTrailingCapabilityNoun(recipe.title) || recipe.title;
}

const KNOWN_SLOT_FORMAT_EXTENSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  gguf: ['.gguf', '.gguf_file'],
  'gguf-bundle': ['.gguf', '.gguf_file'],
  safetensors: ['.safetensors'],
  'safetensors-bundle': ['.safetensors'],
  onnx: ['.onnx'],
  'onnx-bundle': ['.onnx'],
});

export type SlotCandidateAssetPartition = {
  readonly recommended: readonly NimiRuntimeModelAssetRecord[];
  readonly formatMatched: readonly NimiRuntimeModelAssetRecord[];
  readonly other: readonly NimiRuntimeModelAssetRecord[];
  readonly hasFormatFilter: boolean;
};

function assetMatchesFormatExtensions(
  asset: Pick<NimiRuntimeModelAssetRecord, 'entry' | 'files'>,
  extensions: readonly string[],
): boolean {
  const matches = (path: string | undefined) => {
    const lower = (path ?? '').trim().toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
  };
  return matches(asset.entry) || asset.files.some((file) => matches(file.relativePath));
}

/**
 * Pure visual grouping of local ModelAssets for a slot picker. Never hides any
 * installed file; Runtime Prepare remains the sole Model Contract authority.
 */
export function partitionSlotCandidateAssets(
  slot: Pick<NimiLoadoutRecipeSlot, 'recommendedContentIds' | 'offers' | 'modelContract'> | undefined,
  assets: readonly NimiRuntimeModelAssetRecord[],
  selectedAssetId = '',
): SlotCandidateAssetPartition {
  if (!slot) {
    return { recommended: [], formatMatched: [], other: assets, hasFormatFilter: false };
  }
  const ordered = runtimeConfigLoadoutCandidateAssets(slot, assets);
  const recommendedContentIds = new Set(slot.recommendedContentIds);
  const installedOfferIds = new Set((slot.offers ?? [])
    .filter((offer) => offer.applicability !== 'unsupported' && offer.installedModelAssetId)
    .map((offer) => offer.installedModelAssetId));
  const format = typeof slot.modelContract?.format === 'string'
    ? slot.modelContract.format.trim().toLowerCase()
    : '';
  const extensions = KNOWN_SLOT_FORMAT_EXTENSIONS[format];
  const recommended: NimiRuntimeModelAssetRecord[] = [];
  const formatMatched: NimiRuntimeModelAssetRecord[] = [];
  const other: NimiRuntimeModelAssetRecord[] = [];
  for (const asset of ordered) {
    if (
      asset.modelAssetId === selectedAssetId
      || installedOfferIds.has(asset.modelAssetId)
      || recommendedContentIds.has(asset.contentId)
    ) {
      recommended.push(asset);
    } else if (extensions && assetMatchesFormatExtensions(asset, extensions)) {
      formatMatched.push(asset);
    } else {
      other.push(asset);
    }
  }
  return { recommended, formatMatched, other, hasFormatFilter: Boolean(extensions) };
}

export const LLAMA_CPP_DRIVER_ID = 'nimi.runtime.driver.llama-cpp';

export function supportsLlamaTextContextSize(
  recipe: (Pick<NimiLoadoutRecipe, 'capabilityContract'> & {
    readonly implementation?: Partial<NimiLoadoutRecipe['implementation']>;
  }) | undefined,
): boolean {
  return recipe?.capabilityContract === 'text.generate'
    && recipe.implementation?.driverId === LLAMA_CPP_DRIVER_ID;
}

export function parseLoadoutOptionsJson(text: string): NimiJsonObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as NimiJsonObject : null;
  } catch {
    return null;
  }
}

export function patchLoadoutTextContextOption(
  currentOptions: Readonly<NimiJsonObject> | undefined,
  contextSizeDraft: string,
): { readonly valid: true; readonly options: NimiJsonObject } | { readonly valid: false } {
  const next: Record<string, NimiJsonObject[string]> = { ...(currentOptions ?? {}) };
  const trimmed = contextSizeDraft.trim();
  if (!trimmed) {
    delete next.contextSize;
    return { valid: true, options: next };
  }
  if (!/^[1-9]\d*$/u.test(trimmed)) return { valid: false };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { valid: false };
  next.contextSize = parsed;
  return { valid: true, options: next };
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
