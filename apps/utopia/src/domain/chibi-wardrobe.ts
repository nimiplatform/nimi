import type { NimiLocalAppClient } from '@nimiplatform/sdk';

export const CHIBI_WARDROBE_LOCAL_KEY = 'nimi.utopia.chibi-wardrobe.v1';
export const CHIBI_WARDROBE_STORAGE_PATH = 'chibi-wardrobe.v1.json';
const LEGACY_CHIBI_WARDROBE_PENDING_KEY = 'nimi.utopia.chibi-wardrobe.pending.v2';

export type ChibiSkinTone = 'cream' | 'peach' | 'honey' | 'butter' | 'sprout' | 'sky';
export type ChibiHairStyle = 'bob' | 'fluffy' | 'twintails' | 'curly' | 'side-part' | 'pixie';
export type ChibiHairColor =
  | 'chestnut'
  | 'espresso'
  | 'honey-gold'
  | 'auburn'
  | 'sage-green'
  | 'mist-blue'
  | 'berry-rose'
  | 'moon-cream';
export type ChibiEyeStyle = 'sparkle' | 'happy' | 'starry' | 'gentle' | 'curious';
export type ChibiHeadwear =
  | 'star-hat'
  | 'sprout'
  | 'beret'
  | 'sun-hat'
  | 'flower-crown'
  | 'sailor-cap'
  | 'bamboo-hat'
  | 'cat-ears'
  | 'earmuffs'
  | 'goggles'
  | 'ribbon'
  | 'none';
export type ChibiCloakColor =
  | 'mint'
  | 'cornflower'
  | 'apricot'
  | 'lavender'
  | 'ochre'
  | 'meadow'
  | 'teal'
  | 'rose'
  | 'coral'
  | 'pine';

export type ChibiAppearance = Readonly<{
  readonly skinTone: ChibiSkinTone;
  readonly hairStyle: ChibiHairStyle;
  readonly hairColor: ChibiHairColor;
  readonly eyes: ChibiEyeStyle;
  readonly headwear: ChibiHeadwear;
  readonly cloakColor: ChibiCloakColor;
}>;

export type ChibiWardrobeMap = Readonly<Record<string, ChibiAppearance>>;

export const CHIBI_SKIN_OPTIONS: readonly {
  readonly value: ChibiSkinTone;
  readonly label: string;
  readonly fill: string;
  readonly shade: string;
  readonly blush: string;
}[] = [
  { value: 'cream', label: '奶酥白', fill: '#FFF1DA', shade: '#F5DFBE', blush: '#F3988A' },
  { value: 'peach', label: '暖蜜桃', fill: '#FDE2C8', shade: '#F2CCA9', blush: '#EE8B7C' },
  { value: 'honey', label: '麦芽糖', fill: '#F3CEA6', shade: '#E5B889', blush: '#E47B6C' },
  { value: 'butter', label: '星原黄', fill: '#FCE69E', shade: '#F0D278', blush: '#F28E78' },
  { value: 'sprout', label: '森嫩芽', fill: '#D7EDC2', shade: '#BEE0A3', blush: '#EB9387' },
  { value: 'sky', label: '晴云灵', fill: '#D2E9F8', shade: '#B6D8EE', blush: '#EC9595' },
] as const;

export const CHIBI_HAIR_STYLE_OPTIONS: readonly {
  readonly value: ChibiHairStyle;
  readonly label: string;
}[] = [
  { value: 'bob', label: '齐刘海' },
  { value: 'fluffy', label: '蓬松发' },
  { value: 'twintails', label: '双团子' },
  { value: 'curly', label: '绵羊卷' },
  { value: 'side-part', label: '斜分卷' },
  { value: 'pixie', label: '精灵短' },
] as const;

export const CHIBI_HAIR_COLOR_OPTIONS: readonly {
  readonly value: ChibiHairColor;
  readonly label: string;
  readonly fill: string;
  readonly highlight: string;
}[] = [
  { value: 'chestnut', label: '暖栗棕', fill: '#7B5338', highlight: '#9D6F4F' },
  { value: 'espresso', label: '浓墨褐', fill: '#4A392F', highlight: '#6D5647' },
  { value: 'honey-gold', label: '琥珀金', fill: '#DFA84B', highlight: '#F6CB77' },
  { value: 'auburn', label: '枫糖橘', fill: '#C86B4B', highlight: '#E58B6B' },
  { value: 'sage-green', label: '竹青绿', fill: '#6F9F78', highlight: '#92C19B' },
  { value: 'mist-blue', label: '烟岚蓝', fill: '#688EB8', highlight: '#8DB2DA' },
  { value: 'berry-rose', label: '浆果粉', fill: '#C87B8F', highlight: '#E39CAE' },
  { value: 'moon-cream', label: '月白银', fill: '#E8DFCF', highlight: '#FFFDF7' },
] as const;

export const CHIBI_EYE_OPTIONS: readonly {
  readonly value: ChibiEyeStyle;
  readonly label: string;
}[] = [
  { value: 'sparkle', label: '灵动眸' },
  { value: 'happy', label: '弯弯笑' },
  { value: 'starry', label: '星光眼' },
  { value: 'gentle', label: '温婉目' },
  { value: 'curious', label: '古灵精' },
] as const;

export const CHIBI_HEADWEAR_OPTIONS: readonly {
  readonly value: ChibiHeadwear;
  readonly label: string;
}[] = [
  { value: 'star-hat', label: '星原尖帽' },
  { value: 'sprout', label: '森系嫩芽' },
  { value: 'beret', label: '画家贝雷' },
  { value: 'sun-hat', label: '草编晴帽' },
  { value: 'flower-crown', label: '山花花环' },
  { value: 'sailor-cap', label: '海风船帽' },
  { value: 'bamboo-hat', label: '烟雨斗笠' },
  { value: 'cat-ears', label: '绒耳发箍' },
  { value: 'earmuffs', label: '暖绒耳罩' },
  { value: 'goggles', label: '科考风镜' },
  { value: 'ribbon', label: '蝴蝶发结' },
  { value: 'none', label: '自然蓬发' },
] as const;

export const CHIBI_CLOAK_OPTIONS: readonly {
  readonly value: ChibiCloakColor;
  readonly label: string;
  readonly cape: string;
  readonly accent: string;
  readonly trim: string;
}[] = [
  { value: 'mint', label: '海盐薄荷', cape: '#7AC3A3', accent: '#F4B942', trim: '#FFF7DF' },
  { value: 'cornflower', label: '矢车菊蓝', cape: '#78AEE3', accent: '#F28E68', trim: '#FFF6EA' },
  { value: 'apricot', label: '暖杏陶土', cape: '#EA9376', accent: '#75BFA6', trim: '#FFF8EC' },
  { value: 'lavender', label: '暮云紫藤', cape: '#B29AD9', accent: '#F5C451', trim: '#FFF9EF' },
  { value: 'ochre', label: '秋麦琥珀', cape: '#E6B85C', accent: '#5D96BE', trim: '#FFFDF2' },
  { value: 'meadow', label: '春山青苔', cape: '#8AC080', accent: '#E88787', trim: '#FFF8EE' },
  { value: 'teal', label: '松烟青碧', cape: '#68B8B6', accent: '#F2A65E', trim: '#FFF9F0' },
  { value: 'rose', label: '桃夭粉霞', cape: '#DC99BF', accent: '#86C27E', trim: '#FFF8F4' },
  { value: 'coral', label: '珊瑚晨霞', cape: '#E97E6B', accent: '#F4C95D', trim: '#FFF7EC' },
  { value: 'pine', label: '苍松墨翠', cape: '#4F8A7B', accent: '#E8A85A', trim: '#FFF8EE' },
] as const;

const SKIN_SET = new Set<string>(CHIBI_SKIN_OPTIONS.map((o) => o.value));
const HAIR_STYLE_SET = new Set<string>(CHIBI_HAIR_STYLE_OPTIONS.map((o) => o.value));
const HAIR_COLOR_SET = new Set<string>(CHIBI_HAIR_COLOR_OPTIONS.map((o) => o.value));
const EYE_SET = new Set<string>(CHIBI_EYE_OPTIONS.map((o) => o.value));
const HEADWEAR_SET = new Set<string>(CHIBI_HEADWEAR_OPTIONS.map((o) => o.value));
const CLOAK_SET = new Set<string>(CHIBI_CLOAK_OPTIONS.map((o) => o.value));

const DEFAULT_SEED_SKINS: readonly ChibiSkinTone[] = [
  'cream',
  'peach',
  'butter',
  'cream',
  'peach',
  'honey',
];

const DEFAULT_SEED_HEADWEAR: readonly ChibiHeadwear[] = [
  'star-hat',
  'sprout',
  'beret',
  'flower-crown',
  'sun-hat',
  'sailor-cap',
  'cat-ears',
  'ribbon',
  'star-hat',
  'none',
];

function fnv1aHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mixHash(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function seedDefaultChibiAppearance(agentHandle: string): ChibiAppearance {
  const base = fnv1aHash(agentHandle.trim() || 'companion');
  return Object.freeze({
    skinTone: DEFAULT_SEED_SKINS[mixHash(base, 1) % DEFAULT_SEED_SKINS.length]!,
    hairStyle: CHIBI_HAIR_STYLE_OPTIONS[mixHash(base, 2) % CHIBI_HAIR_STYLE_OPTIONS.length]!.value,
    hairColor: CHIBI_HAIR_COLOR_OPTIONS[mixHash(base, 3) % CHIBI_HAIR_COLOR_OPTIONS.length]!.value,
    eyes: CHIBI_EYE_OPTIONS[mixHash(base, 4) % CHIBI_EYE_OPTIONS.length]!.value,
    headwear: DEFAULT_SEED_HEADWEAR[mixHash(base, 5) % DEFAULT_SEED_HEADWEAR.length]!,
    cloakColor: CHIBI_CLOAK_OPTIONS[mixHash(base, 6) % CHIBI_CLOAK_OPTIONS.length]!.value,
  });
}

export function isSameChibiAppearance(a: ChibiAppearance, b: ChibiAppearance): boolean {
  return a.skinTone === b.skinTone
    && a.hairStyle === b.hairStyle
    && a.hairColor === b.hairColor
    && a.eyes === b.eyes
    && a.headwear === b.headwear
    && a.cloakColor === b.cloakColor;
}

function randomIndex(max: number): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

export function randomizeChibiAppearance(current?: ChibiAppearance): ChibiAppearance {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate: ChibiAppearance = Object.freeze({
      skinTone: CHIBI_SKIN_OPTIONS[randomIndex(CHIBI_SKIN_OPTIONS.length)]!.value,
      hairStyle: CHIBI_HAIR_STYLE_OPTIONS[randomIndex(CHIBI_HAIR_STYLE_OPTIONS.length)]!.value,
      hairColor: CHIBI_HAIR_COLOR_OPTIONS[randomIndex(CHIBI_HAIR_COLOR_OPTIONS.length)]!.value,
      eyes: CHIBI_EYE_OPTIONS[randomIndex(CHIBI_EYE_OPTIONS.length)]!.value,
      headwear: CHIBI_HEADWEAR_OPTIONS[randomIndex(CHIBI_HEADWEAR_OPTIONS.length)]!.value,
      cloakColor: CHIBI_CLOAK_OPTIONS[randomIndex(CHIBI_CLOAK_OPTIONS.length)]!.value,
    });
    if (!current || !isSameChibiAppearance(candidate, current)) {
      return candidate;
    }
  }
  return Object.freeze({
    skinTone: current?.skinTone === 'cream' ? 'butter' : 'cream',
    hairStyle: current?.hairStyle === 'bob' ? 'twintails' : 'bob',
    hairColor: current?.hairColor === 'chestnut' ? 'honey-gold' : 'chestnut',
    eyes: current?.eyes === 'sparkle' ? 'happy' : 'sparkle',
    headwear: current?.headwear === 'star-hat' ? 'sprout' : 'star-hat',
    cloakColor: current?.cloakColor === 'mint' ? 'cornflower' : 'mint',
  });
}

export function validateChibiAppearance(raw: unknown): ChibiAppearance | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const skinTone = typeof rec.skinTone === 'string' && SKIN_SET.has(rec.skinTone)
    ? (rec.skinTone as ChibiSkinTone)
    : null;
  const hairStyle = typeof rec.hairStyle === 'string' && HAIR_STYLE_SET.has(rec.hairStyle)
    ? (rec.hairStyle as ChibiHairStyle)
    : null;
  const hairColor = typeof rec.hairColor === 'string' && HAIR_COLOR_SET.has(rec.hairColor)
    ? (rec.hairColor as ChibiHairColor)
    : null;
  const eyes = typeof rec.eyes === 'string' && EYE_SET.has(rec.eyes)
    ? (rec.eyes as ChibiEyeStyle)
    : null;
  const headwear = typeof rec.headwear === 'string' && HEADWEAR_SET.has(rec.headwear)
    ? (rec.headwear as ChibiHeadwear)
    : null;
  const cloakColor = typeof rec.cloakColor === 'string' && CLOAK_SET.has(rec.cloakColor)
    ? (rec.cloakColor as ChibiCloakColor)
    : null;
  if (!skinTone || !hairStyle || !hairColor || !eyes || !headwear || !cloakColor) {
    return null;
  }
  return Object.freeze({ skinTone, hairStyle, hairColor, eyes, headwear, cloakColor });
}

export function parseChibiWardrobePayload(raw: unknown): ChibiWardrobeMap {
  if (!raw || typeof raw !== 'object') return {};
  const container = 'entries' in (raw as Record<string, unknown>)
    && typeof (raw as { entries?: unknown }).entries === 'object'
    && (raw as { entries?: unknown }).entries !== null
    ? ((raw as { entries: Record<string, unknown> }).entries)
    : (raw as Record<string, unknown>);

  const validated: Record<string, ChibiAppearance> = {};
  for (const [handle, item] of Object.entries(container)) {
    if (!handle.trim()) continue;
    const parsed = validateChibiAppearance(item);
    if (parsed) {
      validated[handle] = parsed;
    }
  }
  return Object.freeze(validated);
}

export function resolveWardrobeStorageKey(
  agentHandle: string,
  bindingsByHandle?: Readonly<Record<string, string>>,
): string {
  const binding = bindingsByHandle?.[agentHandle];
  return binding && binding.trim() ? binding : agentHandle;
}

export function hasCustomChibiAppearance(
  agentHandle: string,
  wardrobe?: ChibiWardrobeMap,
  bindingsByHandle?: Readonly<Record<string, string>>,
): boolean {
  if (!wardrobe) return false;
  const binding = bindingsByHandle?.[agentHandle];
  if (binding && binding in wardrobe) return true;
  return agentHandle in wardrobe;
}

export function resolveChibiAppearance(
  agentHandle: string,
  wardrobe?: ChibiWardrobeMap,
  bindingsByHandle?: Readonly<Record<string, string>>,
): ChibiAppearance {
  const binding = bindingsByHandle?.[agentHandle];
  return (binding ? wardrobe?.[binding] : undefined)
    ?? wardrobe?.[agentHandle]
    ?? seedDefaultChibiAppearance(binding && binding.trim() ? binding : agentHandle);
}

export function migrateWardrobeHandlesToBindings(
  wardrobe: ChibiWardrobeMap,
  bindingsByHandle: Readonly<Record<string, string>>,
): { readonly next: ChibiWardrobeMap; readonly changed: boolean } {
  let changed = false;
  const copy: Record<string, ChibiAppearance> = { ...wardrobe };
  for (const [handle, binding] of Object.entries(bindingsByHandle)) {
    if (!binding || handle === binding) continue;
    if (copy[handle] && !copy[binding]) {
      copy[binding] = copy[handle]!;
      delete copy[handle];
      changed = true;
    } else if (copy[handle] && copy[binding]) {
      delete copy[handle];
      changed = true;
    }
  }
  return { next: changed ? Object.freeze(copy) : wardrobe, changed };
}

export type WardrobeCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type WardrobeSyncOptions = Readonly<{
  /** Current account's verified `agentHandle -> agentBinding` map for one-time key migration. */
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  /** Optional explicit browser/test cache storage (defaults to `window.localStorage` when available). */
  readonly localCache?: WardrobeCacheStorage | null;
}>;

export type WardrobeEntryPatch = Readonly<{
  readonly key: string;
  readonly appearance: ChibiAppearance | null;
  readonly deleteKeys?: readonly string[];
}>;

function resolveDefaultLocalCache(explicit?: WardrobeCacheStorage | null): WardrobeCacheStorage | null {
  if (explicit !== undefined) return explicit;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalChibiWardrobe(cache?: WardrobeCacheStorage | null): ChibiWardrobeMap {
  const store = resolveDefaultLocalCache(cache);
  if (!store) return {};
  try {
    const raw = store.getItem(CHIBI_WARDROBE_LOCAL_KEY);
    if (!raw) return {};
    return parseChibiWardrobePayload(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveLocalChibiWardrobe(map: ChibiWardrobeMap, cache?: WardrobeCacheStorage | null): void {
  const store = resolveDefaultLocalCache(cache);
  if (!store) return;
  try {
    store.setItem(
      CHIBI_WARDROBE_LOCAL_KEY,
      JSON.stringify({ schemaVersion: '1.0', entries: map }),
    );
  } catch {
    // Ignore storage quota errors in restricted webviews
  }
}

function clearLegacyUnscopedWardrobeCache(cache: WardrobeCacheStorage | null): void {
  if (!cache) return;
  try {
    cache.removeItem(CHIBI_WARDROBE_LOCAL_KEY);
    cache.removeItem(LEGACY_CHIBI_WARDROBE_PENDING_KEY);
  } catch {
    // Ignore restricted webview storage errors
  }
}

type WardrobeStorageJsonClient = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;

const wardrobeLocks = new WeakMap<object, Promise<void>>();

function serializeWardrobeOp<T>(storage: object, task: () => Promise<T>): Promise<T> {
  const prev = wardrobeLocks.get(storage) ?? Promise.resolve();
  const run = prev.then(task, task);
  wardrobeLocks.set(storage, run.then(() => undefined, () => undefined));
  return run;
}

function isWardrobeNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const rec = error as { reasonCode?: unknown; code?: unknown; message?: unknown };
  const token = `${String(rec.reasonCode ?? '')} ${String(rec.code ?? '')} ${String(rec.message ?? '')}`.toLowerCase();
  return token.includes('not_found') || token.includes('not-found') || token.includes('not found') || token.includes('enoent');
}

function unwrapStorageJsonDocument(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw && 'sizeBytes' in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

async function readManagedWardrobeMapOrThrow(
  storage: Pick<NimiLocalAppClient['storage'], 'readJson'>,
): Promise<ChibiWardrobeMap> {
  try {
    const remoteDoc = await storage.readJson(CHIBI_WARDROBE_STORAGE_PATH);
    return parseChibiWardrobePayload(unwrapStorageJsonDocument(remoteDoc));
  } catch (err) {
    if (isWardrobeNotFoundError(err)) {
      return {};
    }
    throw err;
  }
}

export async function loadPersistedChibiWardrobe(
  storage?: WardrobeStorageJsonClient | null,
  options?: WardrobeSyncOptions,
): Promise<ChibiWardrobeMap> {
  const cache = resolveDefaultLocalCache(options?.localCache);
  if (!storage || typeof storage.readJson !== 'function') {
    return readLocalChibiWardrobe(cache);
  }
  // Account-scoped managed storage is the sole authority; purge legacy unscoped browser keys
  // so switching to an empty account can never leak a previous account's looks.
  clearLegacyUnscopedWardrobeCache(cache);

  return serializeWardrobeOp(storage, async () => {
    const current = await readManagedWardrobeMapOrThrow(storage);
    if (!options?.bindingsByHandle) {
      return current;
    }
    const migrated = migrateWardrobeHandlesToBindings(current, options.bindingsByHandle);
    if (migrated.changed && typeof storage.writeJson === 'function') {
      try {
        await storage.writeJson(CHIBI_WARDROBE_STORAGE_PATH, {
          schemaVersion: '1.0',
          entries: migrated.next,
        });
      } catch {
        // Keep migrated view in memory; next explicit edit will persist cleanly
      }
    }
    return migrated.next;
  });
}

export async function patchPersistedChibiWardrobeEntry(
  patch: WardrobeEntryPatch,
  storage?: WardrobeStorageJsonClient | null,
  options?: WardrobeSyncOptions,
): Promise<ChibiWardrobeMap> {
  const targetKey = patch.key.trim();
  if (!targetKey) {
    throw new Error('wardrobe entry key is required');
  }
  const cache = resolveDefaultLocalCache(options?.localCache);
  if (!storage || typeof storage.writeJson !== 'function' || typeof storage.readJson !== 'function') {
    const base = readLocalChibiWardrobe(cache);
    const nextEntries: Record<string, ChibiAppearance> = { ...base };
    for (const delKey of patch.deleteKeys ?? []) {
      if (delKey) delete nextEntries[delKey];
    }
    if (patch.appearance === null) {
      delete nextEntries[targetKey];
    } else {
      nextEntries[targetKey] = patch.appearance;
    }
    const frozen = Object.freeze(nextEntries);
    saveLocalChibiWardrobe(frozen, cache);
    return frozen;
  }
  clearLegacyUnscopedWardrobeCache(cache);

  return serializeWardrobeOp(storage, async () => {
    const current = await readManagedWardrobeMapOrThrow(storage);
    const nextEntries: Record<string, ChibiAppearance> = { ...current };
    for (const delKey of patch.deleteKeys ?? []) {
      if (delKey) delete nextEntries[delKey];
    }
    if (patch.appearance === null) {
      delete nextEntries[targetKey];
    } else {
      nextEntries[targetKey] = patch.appearance;
    }
    const frozen = Object.freeze(nextEntries);
    await storage.writeJson(CHIBI_WARDROBE_STORAGE_PATH, {
      schemaVersion: '1.0',
      entries: frozen,
    });
    return frozen;
  });
}

export function describeChibiAppearanceSummary(appearance: ChibiAppearance): string {
  const hat = CHIBI_HEADWEAR_OPTIONS.find((o) => o.value === appearance.headwear)?.label ?? '';
  const hair = CHIBI_HAIR_STYLE_OPTIONS.find((o) => o.value === appearance.hairStyle)?.label ?? '';
  const cloak = CHIBI_CLOAK_OPTIONS.find((o) => o.value === appearance.cloakColor)?.label ?? '';
  return [hat, hair, cloak].filter(Boolean).join(' · ');
}
