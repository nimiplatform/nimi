// One logical App merges across its sources (Registry install, local import,
// local-development registrations) into a single rail/home row. Per-source
// entries stay intact on the group so actions remain source-exact.

import type { DesktopAppsEntry, DesktopAppSourceClass } from './apps-panel-projection.js';
import { appRunVisualState, isEntryRunActive, type AppsSortId } from './apps-card-fields.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

export interface DesktopAppGroup {
  readonly appId: string;
  readonly displayName: string;
  readonly iconUrl: string | null;
  /** The entry the row acts on: live run first, then installed, dev, catalog. */
  readonly primary: DesktopAppsEntry;
  /** Every source entry, primary first. */
  readonly entries: readonly DesktopAppsEntry[];
  /** Distinct source classes present, primary first. */
  readonly sourceClasses: readonly DesktopAppSourceClass[];
  readonly updatedAtUnixMs: number;
  readonly active: boolean;
  readonly running: boolean;
  readonly starting: boolean;
}

function entryRank(entry: DesktopAppsEntry): number {
  if (isEntryRunActive(entry)) return 0;
  if (entry.committedRelease && entry.identity.sourceClass === 'verified') return 1;
  if (entry.committedRelease && entry.identity.sourceClass === 'user_imported') return 2;
  if (entry.localDevelopment) return 3;
  return 4;
}

function realDisplayName(entry: DesktopAppsEntry): string | null {
  const name = entry.identity.displayName.trim();
  return name !== '' && name !== entry.identity.appId ? name : null;
}

export function groupAppsEntries(entries: readonly DesktopAppsEntry[]): readonly DesktopAppGroup[] {
  const byAppId = new Map<string, DesktopAppsEntry[]>();
  for (const entry of entries) {
    const list = byAppId.get(entry.identity.appId) ?? [];
    list.push(entry);
    byAppId.set(entry.identity.appId, list);
  }
  return [...byAppId.values()].map((groupEntries) => {
    const ordered = [...groupEntries].sort((left, right) => (
      entryRank(left) - entryRank(right)
      || right.identity.updatedAtUnixMs - left.identity.updatedAtUnixMs
      || left.identity.entryKey.localeCompare(right.identity.entryKey)
    ));
    const primary = ordered[0]!;
    const sourceClasses: DesktopAppSourceClass[] = [];
    for (const entry of ordered) {
      if (!sourceClasses.includes(entry.identity.sourceClass)) sourceClasses.push(entry.identity.sourceClass);
    }
    const visualStates = ordered.map((entry) => appRunVisualState(entry.run?.state ?? null));
    return {
      appId: primary.identity.appId,
      displayName: realDisplayName(primary) ?? ordered.map(realDisplayName).find((name) => name !== null) ?? primary.identity.displayName,
      iconUrl: primary.iconUrl ?? ordered.find((entry) => entry.iconUrl !== null)?.iconUrl ?? null,
      primary,
      entries: ordered,
      sourceClasses,
      updatedAtUnixMs: ordered.reduce((max, entry) => Math.max(max, entry.identity.updatedAtUnixMs), 0),
      active: ordered.some(isEntryRunActive),
      running: visualStates.includes('running'),
      starting: !visualStates.includes('running') && visualStates.includes('starting'),
    };
  });
}

export function filterAppGroups(
  groups: readonly DesktopAppGroup[],
  query: string,
): readonly DesktopAppGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return groups;
  return groups.filter((group) => (
    group.displayName.toLocaleLowerCase().includes(normalized)
    || group.entries.some((entry) => (
      entry.identity.displayName.toLocaleLowerCase().includes(normalized)
      || entry.identity.appId.toLocaleLowerCase().includes(normalized)
    ))
  ));
}

export function sortAppGroups(
  groups: readonly DesktopAppGroup[],
  sort: AppsSortId,
): readonly DesktopAppGroup[] {
  const copy = [...groups];
  if (sort === 'name') {
    return copy.sort((left, right) => (
      left.displayName.localeCompare(right.displayName)
      || left.appId.localeCompare(right.appId)
    ));
  }
  if (sort === 'activity') {
    return copy.sort((left, right) => (
      Number(right.active) - Number(left.active)
      || right.updatedAtUnixMs - left.updatedAtUnixMs
      || left.appId.localeCompare(right.appId)
    ));
  }
  return copy.sort((left, right) => (
    right.updatedAtUnixMs - left.updatedAtUnixMs
    || left.appId.localeCompare(right.appId)
  ));
}

/**
 * Steam-style rail sectioning: a 运行中 strip on top, the remaining Apps as
 * one unlabeled list. While searching the rail stays a single flat result set.
 */
export function splitRunningGroups(
  groups: readonly DesktopAppGroup[],
): { readonly running: readonly DesktopAppGroup[]; readonly rest: readonly DesktopAppGroup[] } {
  return {
    running: groups.filter((group) => group.active),
    rest: groups.filter((group) => !group.active),
  };
}

/** Sibling source entries for the detail surface, excluding the open one. */
export function siblingSourceEntries(
  entries: readonly DesktopAppsEntry[],
  entry: DesktopAppsEntry,
): readonly DesktopAppsEntry[] {
  return groupAppsEntries(entries.filter((candidate) => candidate.identity.appId === entry.identity.appId))
    .find((group) => group.appId === entry.identity.appId)
    ?.entries.filter((candidate) => candidate.identity.entryKey !== entry.identity.entryKey) ?? [];
}

/**
 * Group-level structural sharing on top of entry reconciliation: a group whose
 * ordered entries are all reference-identical keeps its previous object, so
 * memoized rail rows skip quiet polls.
 */
export function reconcileAppGroups(
  previous: readonly DesktopAppGroup[],
  next: readonly DesktopAppGroup[],
): readonly DesktopAppGroup[] {
  if (previous.length === 0) return next;
  const previousByAppId = new Map(previous.map((group) => [group.appId, group]));
  return next.map((group) => {
    const before = previousByAppId.get(group.appId);
    if (!before) return group;
    const same = before.primary === group.primary
      && before.entries.length === group.entries.length
      && before.entries.every((entry, index) => entry === group.entries[index]);
    return same ? before : group;
  });
}
