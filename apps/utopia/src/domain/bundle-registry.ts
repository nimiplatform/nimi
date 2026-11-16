import { openNimiAppAssetMediaUrl } from '@nimiplatform/kit/core/app-asset-media';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import {
  validateHabitatSpecV1,
  type HabitatSpecV1,
  type NimiLocalAppAssetsClient,
} from '@nimiplatform/sdk/app';
import {
  UtopiaBundleValidationError,
  computeHabitatContentDigest,
  parseAndValidateUtopiaZip,
  validateBundleManifestV1,
  validateDeclarativeStageV1,
  type UtopiaBundleManifestV1,
  type UtopiaDeclarativeStageV1,
  type ValidatedUtopiaBundle,
} from './bundle-validator.js';

export const BUNDLES_INDEX_PATH = 'bundles-index.json';
export const BUILTIN_PACK_SLUGS = ['seaside-island', 'starfield-town', 'polar-station', 'cloud-bamboo-abode'] as const;

export type InstalledUtopiaPack = Readonly<{
  readonly source: 'builtin' | 'imported';
  readonly slug?: string;
  readonly manifest: UtopiaBundleManifestV1;
  readonly habitat: HabitatSpecV1;
  readonly stage: UtopiaDeclarativeStageV1;
  readonly contentDigest: string;
  readonly installedAt: string;
  readonly assetRoot: string | null;
  readonly assetPaths: readonly string[];
}>;

export type ResolvedStageMedia = Readonly<{
  readonly pack: InstalledUtopiaPack;
  readonly assetUrls: Readonly<Record<string, string>>;
  readonly revokeAll: () => Promise<void>;
}>;

type JsonStorageClient = NimiLocalAppClient['storage'];
type JsonStorageWritePayload = Parameters<JsonStorageClient['writeJson']>[1];

export type UtopiaStoragePort = Readonly<{
  readonly json: Pick<JsonStorageClient, 'readJson' | 'writeJson'>;
  readonly assets: Pick<NimiLocalAppAssetsClient, 'list' | 'write' | 'move' | 'remove' | 'read'>;
}>;

type PersistedBundleEntry = {
  readonly manifest: UtopiaBundleManifestV1;
  readonly habitat: HabitatSpecV1;
  readonly stage: UtopiaDeclarativeStageV1;
  readonly contentDigest: string;
  readonly installedAt: string;
  readonly assetRoot: string;
  readonly assetPaths: readonly string[];
};

type PersistedBundlesIndex = {
  readonly schemaVersion: '2.0';
  readonly bundles: readonly PersistedBundleEntry[];
};

function inferAssetKind(relPath: string): 'image' | 'audio' | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image';
  }
  if (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg')) {
    return 'audio';
  }
  return null;
}

function isStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'reasonCode' in error
    ? String((error as { reasonCode?: unknown }).reasonCode ?? '').toLowerCase().replaceAll('_', '-') : '';
  // Runtime APP_STORAGE_ENTRY_NOT_FOUND and its protected Host projection.
  // Error prose (e.g. an unavailable account) never establishes an empty library.
  return code === 'app-storage-entry-not-found' || code === 'not-found';
}

export async function loadBuiltinPackFromFetch(
  slug: (typeof BUILTIN_PACK_SLUGS)[number],
  fetcher: typeof fetch = globalThis.fetch,
): Promise<InstalledUtopiaPack> {
  const baseUrl = `./builtin-packs/${slug}`;
  const [manifestRes, habitatRes, stageRes] = await Promise.all([
    fetcher(`${baseUrl}/manifest.json`),
    fetcher(`${baseUrl}/habitat.json`),
    fetcher(`${baseUrl}/stage.json`),
  ]);
  if (!manifestRes.ok || !habitatRes.ok || !stageRes.ok) {
    throw new Error(`内置样板洞天「${slug}」资源加载失败。`);
  }
  const [rawManifest, rawHabitat, rawStage] = await Promise.all([
    manifestRes.json(),
    habitatRes.json(),
    stageRes.json(),
  ]);
  const manifest = validateBundleManifestV1(rawManifest);
  const habitat = validateHabitatSpecV1(rawHabitat, false);
  const referencedAssets = new Set<string>([manifest.previewAsset]);
  if (rawStage && typeof rawStage === 'object') {
    const rec = rawStage as { layers?: { assetPath?: string }[]; ambientAudio?: { assetPath?: string }[] };
    for (const l of rec.layers ?? []) {
      if (typeof l?.assetPath === 'string') referencedAssets.add(l.assetPath);
    }
    for (const a of rec.ambientAudio ?? []) {
      if (typeof a?.assetPath === 'string') referencedAssets.add(a.assetPath);
    }
  }
  const assetTypes = new Map<string, 'image' | 'audio'>();
  for (const rel of referencedAssets) {
    const kind = inferAssetKind(rel);
    if (kind) assetTypes.set(rel, kind);
  }
  const stage = validateDeclarativeStageV1(rawStage, habitat, assetTypes);
  const contentDigest = await computeHabitatContentDigest(habitat);

  return Object.freeze({
    source: 'builtin',
    slug,
    manifest,
    habitat,
    stage,
    contentDigest,
    installedAt: 'builtin',
    assetRoot: null,
    assetPaths: Array.from(referencedAssets),
  });
}

// The supervised App has one registry writer. Serialize startup cleanup,
// imports, removals, and imported-pack relocations on the backing JSON client
// so removal and activation can never race on the same `.utopia` pack version.
const registryWrites = new WeakMap<object, Promise<unknown>>();
function mutateRegistry<T>(storage: UtopiaStoragePort, action: () => Promise<T>): Promise<T> {
  const lockKey = storage.json;
  const previous = registryWrites.get(lockKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  registryWrites.set(lockKey, next);
  return next;
}

export function relocateWithImportedPackGuard<T>(
  storage: UtopiaStoragePort,
  pack: Pick<InstalledUtopiaPack, 'source' | 'manifest' | 'contentDigest'>,
  executeRelocation: () => Promise<T>,
): Promise<T> {
  return mutateRegistry(storage, async () => {
    if (pack.source === 'imported') {
      const existing = await readImportedPacksIndex(storage);
      const stillPresent = existing.some(
        (item) => item.manifest.bundleId === pack.manifest.bundleId
          && item.contentDigest === pack.contentDigest,
      );
      if (!stillPresent) {
        throw new Error(`洞天包「${pack.manifest.title}」已从本机画卷库移除，请确认或重新导入后再迁居。`);
      }
    }
    return executeRelocation();
  });
}

export function cleanupOrphanedBundleAssets(storage: UtopiaStoragePort): Promise<number> {
  return mutateRegistry(storage, async () => {
    const installed = await readImportedPacksIndex(storage);
    const liveRoots = new Set(installed.map((pack) => pack.assetRoot));
    const orphaned: string[] = [];
    let cursor: string | undefined;
    // Finish pagination before deleting so a failed scan leaves assets untouched.
    // A fixed page cap would repeatedly visit live roots and starve later orphans.
    for (;;) {
      const listed = await storage.assets.list({ prefix: 'bundles/content', ...(cursor ? { cursor } : {}), pageSize: 100 });
      for (const item of listed.assets) {
        const root = item.relativePath.split('/').slice(0, 3).join('/');
        if (!liveRoots.has(root)) orphaned.push(item.relativePath);
      }
      if (!listed.nextCursor) break;
      cursor = listed.nextCursor;
    }
    let removed = 0;
    for (const path of orphaned) {
      if ((await storage.assets.remove(path)).removed) removed++;
    }
    return removed;
  });
}

export async function readImportedPacksIndex(
  storage: UtopiaStoragePort,
): Promise<readonly InstalledUtopiaPack[]> {
  let rawDoc: unknown;
  try {
    const doc = await storage.json.readJson(BUNDLES_INDEX_PATH);
    rawDoc = doc.value;
  } catch (err) {
    if (isStorageNotFoundError(err)) return [];
    throw err;
  }

  const invalid = (): never => { throw new Error('洞天库索引损坏或格式不受支持，已保留现有资源。'); };
  if (!rawDoc || typeof rawDoc !== 'object' || Array.isArray(rawDoc)) invalid();
  const rec = rawDoc as Partial<PersistedBundlesIndex>;
  if (rec.schemaVersion !== '2.0' || !Array.isArray(rec.bundles)) invalid();

  const result: InstalledUtopiaPack[] = [];
  const seen = new Set<string>();
  const seenRoots = new Set<string>();
  for (const entry of rec.bundles!) {
    if (!entry || typeof entry !== 'object') invalid();
    const manifest = validateBundleManifestV1(entry.manifest);
    const habitat = validateHabitatSpecV1(entry.habitat, false);
    if (manifest.bundleId !== habitat.habitatId) invalid();
    if (typeof entry.assetRoot !== 'string' || !/^bundles\/content\/[0-9a-f-]{36}$/u.test(entry.assetRoot)
      || seenRoots.has(entry.assetRoot)
      || typeof entry.installedAt !== 'string' || !Number.isFinite(Date.parse(entry.installedAt))
      || !Array.isArray(entry.assetPaths) || entry.assetPaths.some((p) => typeof p !== 'string'
        || !p.startsWith('assets/') || p.split('/').some((part) => !part || part === '.' || part === '..')
        || /[\\\u0000-\u001f]/u.test(p))) invalid();
    seenRoots.add(entry.assetRoot);
    const assetTypes = new Map<string, 'image' | 'audio'>();
    for (const path of entry.assetPaths) {
      const kind = inferAssetKind(path);
      if (!kind || assetTypes.has(path)) invalid();
      assetTypes.set(path, kind!);
    }
    const stage = validateDeclarativeStageV1(entry.stage, habitat, assetTypes);
    const contentDigest = await computeHabitatContentDigest(habitat);
    if (entry.contentDigest !== contentDigest) invalid();
    const versionIdentity = `${manifest.bundleId}@${contentDigest}`;
    if (seen.has(versionIdentity)) invalid();
    seen.add(versionIdentity);
    result.push(Object.freeze({ source: 'imported', manifest, habitat, stage, contentDigest,
      installedAt: entry.installedAt, assetRoot: entry.assetRoot, assetPaths: entry.assetPaths }));
  }
  return result;
}

function indexEntry(pack: InstalledUtopiaPack): PersistedBundleEntry {
  if (!pack.assetRoot) throw new Error('Imported pack has no immutable asset root');
  return { manifest: pack.manifest, habitat: pack.habitat, stage: pack.stage,
    contentDigest: pack.contentDigest, installedAt: pack.installedAt,
    assetRoot: pack.assetRoot, assetPaths: pack.assetPaths };
}

export type BundleRegistryMutationOptions = Readonly<{
  readonly activeContentDigest?: string | null;
  readonly resolveActiveContentDigest?: () => Promise<string | null>;
  readonly contentDigest?: string;
}>;

// @nimi-authority: rule.nimi.runtime.app-surface.r011
export function importValidatedUtopiaBundle(
  validated: ValidatedUtopiaBundle,
  storage: UtopiaStoragePort,
  _options?: BundleRegistryMutationOptions,
): Promise<InstalledUtopiaPack> {
  return mutateRegistry(storage, async () => {
    const bundleId = validated.manifest.bundleId;
    if (bundleId.startsWith('nimi.builtin.')) {
      throw new UtopiaBundleValidationError('RESERVED_BUNDLE_ID', `导入未通过：命名空间「${bundleId}」为官方内置洞天保留标识。`);
    }
    // A read failure is not an empty library. Do not write assets or replace its index.
    const existing = await readImportedPacksIndex(storage);
    const assetRoot = `bundles/content/${globalThis.crypto.randomUUID()}`;
    const stagedPaths: string[] = [];
    const pack: InstalledUtopiaPack = Object.freeze({ source: 'imported',
      manifest: validated.manifest, habitat: validated.habitat, stage: validated.stage,
      contentDigest: validated.contentDigest, installedAt: new Date().toISOString(),
      assetRoot, assetPaths: Array.from(validated.assets.keys()) });
    try {
      for (const [path, asset] of validated.assets) {
        const target = `${assetRoot}/${path}`;
        // target lives under a fresh immutable UUID root; do NOT pass expectedSha256
        // (which selects Runtime's replaceMetadata CAS guard against an existing file).
        const written = await storage.assets.write({
          relativePath: target,
          body: asset.bytes,
          mediaType: asset.mediaType,
        });
        stagedPaths.push(target);
        if (written.sha256 !== asset.sha256) {
          throw new Error('写入应用受管资产库时摘要校验不一致。');
        }
      }
    } catch (error) {
      await Promise.allSettled(stagedPaths.map((path) => storage.assets.remove(path)));
      throw error;
    }
    // Import only installs: retain all distinct `(bundleId, contentDigest)` versions so missing
    // or lagging Runtime snapshots can never evict an older version still referenced by the account.
    const retained: InstalledUtopiaPack[] = [];
    const evicted: InstalledUtopiaPack[] = [];
    for (const item of existing) {
      if (item.manifest.bundleId === bundleId && item.contentDigest === pack.contentDigest) {
        evicted.push(item);
      } else {
        retained.push(item);
      }
    }
    const payload: PersistedBundlesIndex = { schemaVersion: '2.0',
      bundles: [...retained.map(indexEntry), indexEntry(pack)] };
    // Publication is the only commit point. If its response is lost, leave the
    // immutable bytes in place: startup cleanup resolves them against the index.
    await storage.json.writeJson(BUNDLES_INDEX_PATH, payload as unknown as JsonStorageWritePayload);
    for (const oldPack of evicted) {
      if (oldPack.assetRoot) {
        await Promise.allSettled(oldPack.assetPaths.map((p) => storage.assets.remove(`${oldPack.assetRoot}/${p}`)));
      }
    }
    return pack;
  });
}

export async function importUtopiaArchiveBytes(
  archiveBytes: Uint8Array,
  storage: UtopiaStoragePort,
  options?: BundleRegistryMutationOptions,
): Promise<InstalledUtopiaPack> {
  const validated = await parseAndValidateUtopiaZip(archiveBytes);
  return importValidatedUtopiaBundle(validated, storage, options);
}

export function removeImportedPack(
  bundleId: string,
  storage: UtopiaStoragePort,
  options?: BundleRegistryMutationOptions,
): Promise<void> {
  return mutateRegistry(storage, async () => {
    const existing = await readImportedPacksIndex(storage);
    const target = existing.find((pack) =>
      pack.manifest.bundleId === bundleId
      && (!options?.contentDigest || pack.contentDigest === options.contentDigest),
    );
    if (!target) return;

    let verifiedActiveDigest: string | null = null;
    if (options?.resolveActiveContentDigest) {
      verifiedActiveDigest = await options.resolveActiveContentDigest();
      if (!verifiedActiveDigest) {
        throw new Error('暂时无法确认当前住地使用状态，已暂停移除该洞天包。');
      }
    } else if (options && 'activeContentDigest' in options) {
      if (!options.activeContentDigest) {
        throw new Error('暂时无法确认当前住地使用状态，已暂停移除该洞天包。');
      }
      verifiedActiveDigest = options.activeContentDigest;
    }

    if (verifiedActiveDigest && target.contentDigest === verifiedActiveDigest) {
      throw new Error(`洞天包「${target.manifest.title}」当前正被住地使用，请先迁居至其他洞天后再移除。`);
    }

    await storage.json.writeJson(BUNDLES_INDEX_PATH, { schemaVersion: '2.0',
      bundles: existing.filter((pack) => pack !== target).map(indexEntry),
    } as unknown as JsonStorageWritePayload);
    await Promise.allSettled(target.assetPaths.map((path) => storage.assets.remove(`${target.assetRoot}/${path}`)));
  });
}

export async function resolvePackMediaUrls(
  pack: InstalledUtopiaPack,
  assetsClient: Pick<NimiLocalAppAssetsClient, 'read'>,
  signal?: AbortSignal,
): Promise<ResolvedStageMedia> {
  if (pack.source === 'builtin' && pack.slug) {
    const assetUrls: Record<string, string> = {};
    for (const relPath of pack.assetPaths) {
      assetUrls[relPath] = `./builtin-packs/${pack.slug}/${relPath}`;
    }
    return Object.freeze({
      pack,
      assetUrls,
      revokeAll: async () => undefined,
    });
  }

  const revokers: (() => Promise<void>)[] = [];
  const assetUrls: Record<string, string> = {};
  try {
    for (const relPath of pack.assetPaths) {
      const storagePath = `${pack.assetRoot}/${relPath}`;
      const opened = await openNimiAppAssetMediaUrl(assetsClient, storagePath, signal);
      revokers.push(opened.revoke);
      assetUrls[relPath] = opened.url;
    }
    return Object.freeze({
      pack,
      assetUrls,
      revokeAll: async () => {
        await Promise.allSettled(revokers.map((fn) => fn()));
      },
    });
  } catch (err) {
    await Promise.allSettled(revokers.map((fn) => fn()));
    throw err;
  }
}
