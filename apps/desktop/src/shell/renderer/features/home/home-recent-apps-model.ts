import { readStorageTextFrom, resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';
import { hasAvailableCatalogUpdate } from '../apps/apps-card-actions.js';
import { groupAppsEntries, type DesktopAppGroup } from '../apps/apps-entry-groups.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';

export const HOME_RECENT_APPS_LIMIT = 8;
export const HOME_SPOTLIGHT_APPS_LIMIT = 3;
export const BUNDLED_ZHIYU_RECENT_KEY = 'bundled:zhiyu';
export const BUNDLED_ZHIYU_APP_ID = 'nimi.zhiyu';
const MAX_STORED_RECENT_KEYS = 50;

export type HomeRecentAppItem =
  | Readonly<{
      kind: 'bundled-zhiyu';
      key: typeof BUNDLED_ZHIYU_RECENT_KEY;
      active: false;
      lastOpenedAtMs: number;
      updatedAtUnixMs: number;
    }>
  | Readonly<{
      kind: 'app-group';
      key: string;
      group: DesktopAppGroup;
      active: boolean;
      lastOpenedAtMs: number;
      updatedAtUnixMs: number;
      hasUpdate: boolean;
      disambiguator: string | null;
    }>;

function storageKeyForAccount(accountKey: string | null | undefined): string {
  const scope = accountKey && accountKey.trim() ? accountKey.trim() : 'device';
  return `nimi.home.recent-apps:${encodeURIComponent(scope)}`;
}

export function parseHomeRecentAppTimestamps(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const valid: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.trim() && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        valid[key] = Math.floor(value);
      }
    }
    return valid;
  } catch {
    return {};
  }
}

export function readHomeRecentAppTimestamps(accountKey: string | null | undefined): Readonly<Record<string, number>> {
  const stored = readStorageTextFrom(resolveBrowserStorage('local'), storageKeyForAccount(accountKey));
  if (stored.state !== 'ready') return {};
  return parseHomeRecentAppTimestamps(stored.value);
}

export function recordHomeRecentAppOpen(
  accountKey: string | null | undefined,
  appKey: string,
  nowMs = Date.now(),
): Readonly<Record<string, number>> {
  const normalizedKey = appKey.trim();
  if (!normalizedKey) return readHomeRecentAppTimestamps(accountKey);
  const current = readHomeRecentAppTimestamps(accountKey);
  const merged = Object.entries({
    ...current,
    [normalizedKey]: Math.max(1, Math.floor(nowMs)),
  })
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_STORED_RECENT_KEYS);
  const next = Object.fromEntries(merged);
  writeStorageTextTo(resolveBrowserStorage('local'), storageKeyForAccount(accountKey), JSON.stringify(next));
  return next;
}

function shortAppIdSuffix(appId: string): string {
  const parts = appId.split('.').filter(Boolean);
  return parts[parts.length - 1] || appId;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a
export function buildHomeRecentAppsDock(input: {
  entries: readonly DesktopAppsEntry[];
  timestamps: Readonly<Record<string, number>>;
  bundledZhiyuName?: string;
  limit?: number;
}): {
  readonly items: readonly HomeRecentAppItem[];
  readonly overflowCount: number;
  readonly totalCount: number;
  readonly spotlightCatalog: readonly DesktopAppsEntry[];
} {
  const limit = Math.max(1, input.limit ?? HOME_RECENT_APPS_LIMIT);
  const localEntries = input.entries.filter((entry) => entry.committedRelease || entry.localDevelopment);
  const groups = groupAppsEntries(localEntries);

  const nameCounts = new Map<string, number>();
  if (input.bundledZhiyuName) {
    const zhiyuNorm = input.bundledZhiyuName.trim().toLocaleLowerCase();
    if (zhiyuNorm) nameCounts.set(zhiyuNorm, 1);
  }
  for (const group of groups) {
    const norm = group.displayName.trim().toLocaleLowerCase();
    nameCounts.set(norm, (nameCounts.get(norm) ?? 0) + 1);
  }

  const candidates: HomeRecentAppItem[] = [
    {
      kind: 'bundled-zhiyu',
      key: BUNDLED_ZHIYU_RECENT_KEY,
      active: false,
      lastOpenedAtMs: input.timestamps[BUNDLED_ZHIYU_RECENT_KEY] ?? 0,
      updatedAtUnixMs: Number.MAX_SAFE_INTEGER,
    },
    ...groups.map((group): HomeRecentAppItem => {
      const norm = group.displayName.trim().toLocaleLowerCase();
      const isDuplicateName = (nameCounts.get(norm) ?? 0) > 1;
      const isBundledZhiyuId = group.appId === BUNDLED_ZHIYU_APP_ID;
      const isLocalDevOnly = group.entries.some((entry) => entry.localDevelopment !== null)
        && !group.entries.some((entry) => entry.committedRelease !== null);
      return {
        kind: 'app-group',
        key: group.appId,
        group,
        active: group.active,
        lastOpenedAtMs: input.timestamps[group.appId] ?? 0,
        updatedAtUnixMs: group.updatedAtUnixMs,
        hasUpdate: group.entries.some(hasAvailableCatalogUpdate),
        disambiguator: isBundledZhiyuId
          ? (isLocalDevOnly ? 'DEV' : shortAppIdSuffix(group.appId))
          : isDuplicateName
            ? (isLocalDevOnly ? 'DEV' : shortAppIdSuffix(group.appId))
            : null,
      };
    }),
  ];

  candidates.sort((left, right) => {
    if (left.active !== right.active) {
      return Number(right.active) - Number(left.active);
    }
    const leftOpened = left.lastOpenedAtMs > 0;
    const rightOpened = right.lastOpenedAtMs > 0;
    if (leftOpened !== rightOpened) {
      return Number(rightOpened) - Number(leftOpened);
    }
    if (leftOpened && rightOpened && right.lastOpenedAtMs !== left.lastOpenedAtMs) {
      return right.lastOpenedAtMs - left.lastOpenedAtMs;
    }
    if (right.updatedAtUnixMs !== left.updatedAtUnixMs) {
      return right.updatedAtUnixMs - left.updatedAtUnixMs;
    }
    return left.key.localeCompare(right.key);
  });

  const installedIds = new Set(groups.map((group) => group.appId));
  const spotlightCatalog = groups.length < 3
    ? input.entries
        .filter(
          (entry) =>
            entry.catalogTarget
            && !entry.catalogTarget.policyBlocked
            && !entry.committedRelease
            && !entry.localDevelopment
            && !installedIds.has(entry.identity.appId),
        )
        .slice(0, HOME_SPOTLIGHT_APPS_LIMIT)
    : [];

  const hasOverflow = candidates.length > limit;
  const visibleCount = hasOverflow && limit > 1 ? limit - 1 : limit;
  const items = candidates.slice(0, visibleCount);
  const overflowCount = Math.max(0, candidates.length - items.length);

  return {
    items,
    overflowCount,
    totalCount: candidates.length,
    spotlightCatalog,
  };
}
