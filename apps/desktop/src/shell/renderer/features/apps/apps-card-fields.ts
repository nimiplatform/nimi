/**
 * Presentation derivations for Apps cards. Apps must not inspect app-local
 * files for artwork or icons; identity visuals are derived deterministically
 * from Runtime-projected owner data (appId, displayName) only.
 */
import { isLocalDevelopmentRunActive } from './apps-card-actions.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageTerminalResult,
  type AppPackageJob,
} from '@nimiplatform/sdk/runtime/wire-types';

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

export type AppRunVisualState = 'running' | 'starting' | 'stopped' | 'failed';

/**
 * Terminal run states that mean the last launch or rebuild actually failed.
 * They must stay visually distinct from a clean stop: collapsing them into
 * 'stopped' makes a failed launch look like nothing happened.
 */
const FAILED_RUN_STATES = Object.freeze([
  'failed',
  'build-failed',
  'cleanup-failed',
  'registration-unavailable',
] as const);

export function appRunVisualState(runState: string | null): AppRunVisualState {
  if (runState === 'running') return 'running';
  if (isLocalDevelopmentRunActive(runState)) return 'starting';
  if (runState !== null && (FAILED_RUN_STATES as readonly string[]).includes(runState)) return 'failed';
  return 'stopped';
}

export const APP_RUN_BADGE_TONE = Object.freeze({
  running: 'success',
  starting: 'info',
  stopped: 'neutral',
  failed: 'danger',
} as const);

export function isEntryRunActive(entry: DesktopAppsEntry): boolean {
  return isLocalDevelopmentRunActive(entry.run?.state ?? null);
}

export type AppSourceId = 'local_development' | 'user_imported' | 'verified';

export function appSourceForEntry(entry: DesktopAppsEntry): AppSourceId {
  return entry.identity.sourceClass;
}

export type AppPackagePhaseLocaleKey =
  | 'queued'
  | 'resolve_descriptor'
  | 'download'
  | 'verify'
  | 'materialize'
  | 'swap'
  | 'uninstalling'
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'uninstalled';

export function appPackagePhaseLocaleKey(job: AppPackageJob): AppPackagePhaseLocaleKey | null {
  switch (job.phase) {
    case AppPackageJobPhase.QUEUED: return 'queued';
    case AppPackageJobPhase.DOWNLOADING:
    case AppPackageJobPhase.ACQUIRING_MISSING: return 'download';
    case AppPackageJobPhase.READING_LOCAL: return 'resolve_descriptor';
    case AppPackageJobPhase.VERIFYING:
    case AppPackageJobPhase.VERIFYING_INSTALLED: return 'verify';
    case AppPackageJobPhase.STAGING: return 'materialize';
    case AppPackageJobPhase.COMMITTING: return 'swap';
    case AppPackageJobPhase.REMOVING_PACKAGE:
    case AppPackageJobPhase.UNREGISTERING: return 'uninstalling';
    case AppPackageJobPhase.COMPLETED:
      return job.kind === AppPackageJobKind.UNINSTALL ? 'uninstalled' : 'installed';
    case AppPackageJobPhase.FAILED: return 'failed';
    case AppPackageJobPhase.CANCELED: return 'cancelled';
    default: return null;
  }
}

export function appPackageProgressText(job: AppPackageJob): string | null {
  if (job.progressBasis === AppPackageProgressBasis.BYTES && job.bytesTotal) {
    const completed = safeUnsignedBigInt(job.bytesCompleted);
    const total = safeUnsignedBigInt(job.bytesTotal);
    if (completed !== null && total !== null && total > 0n) {
      const percent = Number((completed * 100n) / total);
      return `${Math.min(100, percent)}%`;
    }
  }
  if (job.progressBasis === AppPackageProgressBasis.STEPS && job.stepsTotal) {
    const completed = safeUnsignedBigInt(job.stepsCompleted);
    const total = safeUnsignedBigInt(job.stepsTotal);
    if (completed !== null && total !== null && total > 0n) return `${completed}/${total}`;
  }
  return null;
}

export function appPackageFailureReason(job: AppPackageJob): string | null {
  if (
    job.phase !== AppPackageJobPhase.FAILED
    && job.terminalResult !== AppPackageTerminalResult.FAILED
  ) return null;
  return job.reasonCode.trim() || null;
}

function safeUnsignedBigInt(value: string): bigint | null {
  if (!/^\d+$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export type AppsSortId = 'updated' | 'name' | 'activity';

export function filterAppsEntries(
  entries: readonly DesktopAppsEntry[],
  query: string,
): readonly DesktopAppsEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries;
  return entries.filter(({ identity }) => (
    identity.displayName.toLocaleLowerCase().includes(normalized)
    || identity.appId.toLocaleLowerCase().includes(normalized)
  ));
}

export function sortAppsEntries(
  entries: readonly DesktopAppsEntry[],
  sort: AppsSortId,
): readonly DesktopAppsEntry[] {
  const copy = [...entries];
  if (sort === 'name') {
    return copy.sort((left, right) => (
      left.identity.displayName.localeCompare(right.identity.displayName)
      || left.identity.appId.localeCompare(right.identity.appId)
    ));
  }
  if (sort === 'activity') {
    return copy.sort((left, right) => (
      Number(isEntryRunActive(right)) - Number(isEntryRunActive(left))
      || right.identity.updatedAtUnixMs - left.identity.updatedAtUnixMs
      || left.identity.appId.localeCompare(right.identity.appId)
    ));
  }
  return copy.sort((left, right) => (
    right.identity.updatedAtUnixMs - left.identity.updatedAtUnixMs
    || left.identity.appId.localeCompare(right.identity.appId)
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
export function resolveDetailEntryKey(
  entries: readonly DesktopAppsEntry[],
  currentEntryKey: string | null,
): string | null {
  if (currentEntryKey && entries.some((entry) => entry.identity.entryKey === currentEntryKey)) {
    return currentEntryKey;
  }
  return null;
}
