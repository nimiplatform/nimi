/**
 * Presentation derivations for Apps cards. Apps must not inspect app-local
 * files for artwork or icons; identity visuals are derived deterministically
 * from Runtime-projected owner data (appId, displayName) only.
 */
import { isLocalDevelopmentRunActive } from './apps-card-actions.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

/**
 * Stable identity fallback. The Runtime-projected display name is already
 * owner data, so the glyph never touches app-local files.
 */
export function deriveIconGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toLocaleUpperCase();
}

export interface AppArtwork {
  /** Saturated gradient for the small identity tile. */
  readonly iconBackground: string;
  /** Wider three-stop gradient for card covers and the detail hero. */
  readonly coverBackground: string;
}

const APP_ARTWORK_PALETTES: readonly AppArtwork[] = Object.freeze([
  {
    iconBackground: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
    coverBackground: 'linear-gradient(120deg, #e0f2fe 0%, #dbeafe 58%, #eff6ff 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
    coverBackground: 'linear-gradient(120deg, #ccfbf1 0%, #cffafe 58%, #f0fdfa 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
    coverBackground: 'linear-gradient(120deg, #ede9fe 0%, #f3e8ff 58%, #faf5ff 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #fb7185 0%, #e11d48 100%)',
    coverBackground: 'linear-gradient(120deg, #ffe4e6 0%, #fce7f3 58%, #fff1f2 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #fbbf24 0%, #f97316 100%)',
    coverBackground: 'linear-gradient(120deg, #fef3c7 0%, #ffedd5 58%, #fffbeb 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)',
    coverBackground: 'linear-gradient(120deg, #e0e7ff 0%, #ede9fe 58%, #eef2ff 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
    coverBackground: 'linear-gradient(120deg, #d1fae5 0%, #dcfce7 58%, #ecfdf5 100%)',
  },
  {
    iconBackground: 'linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)',
    coverBackground: 'linear-gradient(120deg, #cffafe 0%, #e0f2fe 58%, #ecfeff 100%)',
  },
]);

/**
 * Deterministic FNV-1a hash so a given appId always lands on the same
 * palette across sessions and surfaces.
 */
export function appArtworkFor(appId: string): AppArtwork {
  let hash = 2166136261;
  for (let index = 0; index < appId.length; index += 1) {
    hash ^= appId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return APP_ARTWORK_PALETTES[(hash >>> 0) % APP_ARTWORK_PALETTES.length]
    ?? APP_ARTWORK_PALETTES[0]!;
}

export type AppRunVisualState = 'running' | 'starting' | 'stopped';

export function appRunVisualState(runState: string | null): AppRunVisualState {
  if (runState === 'running') return 'running';
  if (isLocalDevelopmentRunActive(runState)) return 'starting';
  return 'stopped';
}

export const APP_RUN_BADGE_TONE = Object.freeze({
  running: 'success',
  starting: 'info',
  stopped: 'neutral',
} as const);

export function isEntryRunActive(entry: DesktopAppsEntry): boolean {
  return isLocalDevelopmentRunActive(entry.run?.state ?? null);
}

export type AppSourceId = 'local_development' | 'user_imported' | 'verified';

/**
 * Only the local-development provenance is admitted in the current slice
 * (p-napp-001a); immutable-package provenances arrive with their Runtime
 * lifecycle owner. Callers render the badge from this single id.
 */
export const CURRENT_APP_SOURCE: AppSourceId = 'local_development';

export type AppsSortId = 'updated' | 'name' | 'activity';

export function filterAppsEntries(
  entries: readonly DesktopAppsEntry[],
  query: string,
): readonly DesktopAppsEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries;
  return entries.filter(({ registration }) => (
    registration.displayName.toLocaleLowerCase().includes(normalized)
    || registration.appId.toLocaleLowerCase().includes(normalized)
  ));
}

export function sortAppsEntries(
  entries: readonly DesktopAppsEntry[],
  sort: AppsSortId,
): readonly DesktopAppsEntry[] {
  const copy = [...entries];
  if (sort === 'name') {
    return copy.sort((left, right) => (
      left.registration.displayName.localeCompare(right.registration.displayName)
      || left.registration.appId.localeCompare(right.registration.appId)
    ));
  }
  if (sort === 'activity') {
    return copy.sort((left, right) => (
      Number(isEntryRunActive(right)) - Number(isEntryRunActive(left))
      || right.registration.updatedAtUnixMs - left.registration.updatedAtUnixMs
      || left.registration.appId.localeCompare(right.registration.appId)
    ));
  }
  return copy.sort((left, right) => (
    right.registration.updatedAtUnixMs - left.registration.updatedAtUnixMs
    || left.registration.appId.localeCompare(right.registration.appId)
  ));
}

/**
 * Running apps pin to the top of the library ordering (WeChat-style sticky);
 * the active sort still applies within the running and stopped groups.
 */
export function pinRunningAppsFirst(
  entries: readonly DesktopAppsEntry[],
): readonly DesktopAppsEntry[] {
  const running = entries.filter(isEntryRunActive);
  const stopped = entries.filter((entry) => !isEntryRunActive(entry));
  return [...running, ...stopped];
}

/**
 * The detail surface only exists while its entry is projected. `null` means
 * the library view; the controller never fabricates a fallback selection.
 */
export function resolveDetailAppId(
  entries: readonly DesktopAppsEntry[],
  currentAppId: string | null,
): string | null {
  if (currentAppId && entries.some((entry) => entry.registration.appId === currentAppId)) {
    return currentAppId;
  }
  return null;
}
