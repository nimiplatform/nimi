import type { CareCircle, CircleKind, DayProfile, Instant, Language, SourceGroupPreference, SourceLink, SourcePreference } from './types.js';

export const NIMIDAY_APP_ID = 'nimi.day';

/** The subset of a public App Activity record NimiDay reads. */
export type ActivityRecordLike = {
  readonly activityId: string;
  /** Publisher key; stable for one business object within one publisher. */
  readonly key?: string;
  readonly source: {
    readonly kind: 'app' | 'runtime-agent';
    /** The publishing registration; groups are only compared within one. */
    readonly sourceRef?: string | null;
    readonly appId: string | null;
    readonly displayName: string | null;
    readonly available: boolean;
  };
  /** Publisher-declared grouping inside its own records (e.g. one child); opaque. */
  readonly groupRef?: string | null;
  readonly revision: number;
  readonly kind: 'activity' | 'todo';
  readonly todoState: 'open' | 'completed' | 'cancelled' | null;
  readonly attention: boolean;
  readonly title: string;
  readonly summary: string | null;
  readonly objectRef: string | null;
  readonly type: string;
  readonly occurredAt: string;
  readonly agent: { readonly displayName: string } | null;
  readonly userView: { readonly unread: boolean; readonly needsAttention: boolean };
};

/** What a record is, so an app's reading is never mistaken for a fact or a task. */
export type SourceNature = 'reminder' | 'record' | 'interpretation';

export type SourceChange = {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly type: string;
  readonly nature: SourceNature;
  readonly title: string;
  readonly summary: string | null;
  readonly occurredAt: Instant;
  readonly todoState: 'open' | 'completed' | 'cancelled' | null;
  readonly unread: boolean;
  readonly needsAttention: boolean;
  readonly openable: boolean;
  readonly sourceAvailable: boolean;
  readonly revision: number;
  readonly circleId: string | null;
  /** Known publishers get a specific label and suggested action. */
  readonly known: KnownSourceType | null;
  /** The publisher's group this record belongs to, when it declares one. */
  readonly groupKey: string | null;
  /** Stable key of the business object across its revisions. */
  readonly objectKey?: string | null;
};

export type KnownSourceType = 'parentos-growth-record' | 'parentos-care-reminder' | 'shijing-daily-mirror';

type KnownSource = {
  readonly nature: SourceNature;
  readonly known: KnownSourceType;
  readonly circleKinds: readonly CircleKind[];
};

const KNOWN_TYPES: Readonly<Record<string, KnownSource>> = {
  'nimi.parentos.growth-record-reminder.v1': {
    nature: 'reminder',
    known: 'parentos-growth-record',
    circleKinds: ['child'],
  },
  // Vaccines, check-ups, eyesight and dental visits that are due for a child.
  'nimi.parentos.care-reminder.v1': {
    nature: 'reminder',
    known: 'parentos-care-reminder',
    circleKinds: ['child'],
  },
  'nimi.shijing.rijing-reading.v1': {
    nature: 'interpretation',
    known: 'shijing-daily-mirror',
    circleKinds: ['self'],
  },
};

/** Life-oriented publishers NimiDay follows unless the user turns them off. */
const DEFAULT_FOLLOWED_APPS: ReadonlySet<string> = new Set(['nimi.parentos', 'nimi.shijing']);

export function sourcePreferenceFor(profile: DayProfile, appId: string): SourcePreference {
  return profile.sources.find((preference) => preference.appId === appId)
    ?? { appId, enabled: DEFAULT_FOLLOWED_APPS.has(appId), circleId: null };
}

/** Groups are keyed per publishing registration, never by the bare publisher value. */
export function sourceGroupKey(record: Pick<ActivityRecordLike, 'source' | 'groupRef'>): string | null {
  const sourceRef = record.source.sourceRef;
  return sourceRef && record.groupRef ? `${sourceRef}\u0000${record.groupRef}` : null;
}

export function sourceGroupFor(profile: DayProfile, key: string | null): SourceGroupPreference | null {
  return key ? profile.sourceGroups.find((entry) => entry.key === key) ?? null : null;
}

function defaultCircle(circles: readonly CareCircle[], kinds: readonly CircleKind[]): string | null {
  for (const kind of kinds) {
    const match = circles.find((circle) => circle.kind === kind && circle.status !== 'ended');
    if (match) return match.id;
  }
  return null;
}

export function toSourceChange(
  record: ActivityRecordLike,
  profile: DayProfile,
  circles: readonly CareCircle[],
): SourceChange | null {
  if (record.source.kind !== 'app' || !record.source.appId || record.source.appId === NIMIDAY_APP_ID) return null;
  const appId = record.source.appId;
  const known = KNOWN_TYPES[record.type] ?? null;
  const preference = sourcePreferenceFor(profile, appId);
  const groupKey = sourceGroupKey(record);
  const group = sourceGroupFor(profile, groupKey);
  const usable = (id: string | null | undefined): id is string => Boolean(id) && circles.some((circle) => circle.id === id && circle.status !== 'ended');
  // One group (say, one child) can go to its own circle; otherwise the App's choice, then a sensible default.
  const mappedCircle = usable(group?.circleId)
    ? group!.circleId!
    : usable(preference.circleId) ? preference.circleId : defaultCircle(circles, known?.circleKinds ?? []);
  return {
    id: record.activityId,
    appId,
    appName: record.source.displayName?.trim() || appId,
    type: record.type,
    nature: known?.nature ?? (record.kind === 'todo' ? 'reminder' : 'record'),
    title: record.title,
    summary: record.summary,
    occurredAt: record.occurredAt,
    todoState: record.todoState,
    unread: record.userView.unread,
    needsAttention: record.userView.needsAttention,
    openable: record.objectRef !== null && record.source.available && (record.kind !== 'todo' || record.todoState === 'open'),
    sourceAvailable: record.source.available,
    revision: record.revision,
    circleId: mappedCircle,
    known: known?.known ?? null,
    groupKey,
    objectKey: sameObjectKey(record),
  };
}

export type SourceGroup = {
  readonly key: string;
  readonly count: number;
  /** A few distinct titles so the user can tell the groups apart. */
  readonly examples: readonly string[];
  readonly firstAt: Instant;
};

/** How much of a listing is in hand: all of it, or only part with more to load. */
export type ListingCoverage = 'loading' | 'complete' | 'partial';

/** What part of the shared activity NimiDay is working from. */
export type ActivityCoverage = {
  /** Every to-do still open in its own App (listed on its own, so age never hides one). */
  readonly openTodos: ListingCoverage;
  /** Recent activity, newest first: everything, or only the newest `recentCount` records. */
  readonly recent: ListingCoverage;
  readonly recentCount: number;
};

/** What is missing from the shared activity in hand, said plainly; empty when nothing is. */
export function coverageGaps(coverage: ActivityCoverage, language: Language): string[] {
  const zh = language === 'zh';
  const gaps: string[] = [];
  if (coverage.openTodos !== 'complete') {
    gaps.push(coverage.openTodos === 'loading'
      ? (zh ? '其他 App 的未完成提醒还在载入，可能不全。' : "Other apps' open reminders are still loading and may be incomplete.")
      : (zh ? '其他 App 的未完成提醒没能全部载入，可能有遗漏。' : "Not all open reminders from other apps could be loaded; some may be missing."));
  }
  if (coverage.recent !== 'complete') {
    gaps.push(coverage.recent === 'loading'
      ? (zh ? '其他 App 最近的动态还在载入。' : "Other apps' recent activity is still loading.")
      : (zh ? `其他 App 的动态只载入了最新的 ${coverage.recentCount} 条，更早的没有载入。` : `Only the newest ${coverage.recentCount} shared records were loaded; older ones are not included.`));
  }
  return gaps;
}

export type SourceApp = {
  readonly appId: string;
  readonly appName: string;
  readonly count: number;
  readonly latestAt: Instant;
  /** Publisher-declared groups, oldest first so their numbering stays stable. */
  readonly groups: readonly SourceGroup[];
  /** Records the publisher did not group (yet); they follow the App-wide choice. */
  readonly ungrouped: { readonly count: number; readonly examples: readonly string[] };
};

/** Publishers seen in the account, for the source settings list. */
export function sourceApps(records: readonly ActivityRecordLike[]): SourceApp[] {
  const byApp = new Map<string, Omit<SourceApp, 'groups' | 'ungrouped'>>();
  const groups = new Map<string, Map<string, { count: number; examples: string[]; firstAt: string }>>();
  const ungrouped = new Map<string, { count: number; examples: string[] }>();
  for (const record of records) {
    const appId = record.source.appId;
    if (record.source.kind !== 'app' || !appId || appId === NIMIDAY_APP_ID) continue;
    const previous = byApp.get(appId);
    const appName = record.source.displayName?.trim() || appId;
    byApp.set(appId, {
      appId,
      appName: previous?.appName ?? appName,
      count: (previous?.count ?? 0) + 1,
      latestAt: previous && previous.latestAt > record.occurredAt ? previous.latestAt : record.occurredAt,
    });
    const key = sourceGroupKey(record);
    if (!key) {
      const loose = ungrouped.get(appId) ?? { count: 0, examples: [] };
      loose.count += 1;
      if (loose.examples.length < 3 && !loose.examples.includes(record.title)) loose.examples.push(record.title);
      ungrouped.set(appId, loose);
      continue;
    }
    const appGroups = groups.get(appId) ?? new Map();
    const group = appGroups.get(key) ?? { count: 0, examples: [], firstAt: record.occurredAt };
    group.count += 1;
    if (group.examples.length < 3 && !group.examples.includes(record.title)) group.examples.push(record.title);
    if (record.occurredAt < group.firstAt) group.firstAt = record.occurredAt;
    appGroups.set(key, group);
    groups.set(appId, appGroups);
  }
  return [...byApp.values()]
    .map((app) => ({
      ...app,
      groups: [...(groups.get(app.appId)?.entries() ?? [])]
        .map(([key, group]) => ({ key, count: group.count, examples: group.examples, firstAt: group.firstAt }))
        .sort((a, b) => (a.firstAt < b.firstAt ? -1 : a.firstAt > b.firstAt ? 1 : a.key < b.key ? -1 : 1)),
      ungrouped: ungrouped.get(app.appId) ?? { count: 0, examples: [] },
    }))
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}

/**
 * One business object inside one publisher's records (several revisions or
 * records about the same object). Different registrations of the same App are
 * different sources: their records are never merged, since an object
 * reference means nothing outside the source that published it.
 */
function sameObjectKey(record: ActivityRecordLike): string | null {
  const object = record.objectRef ?? record.key ?? null;
  const source = record.source.sourceRef;
  return object && source && record.source.appId ? `${source}\u0000${record.source.appId}\u0000${record.type}\u0000${object}` : null;
}

/** The other App's reminder an arrangement was made for, as currently known; null when it is not in hand. */
export function linkedSource(link: SourceLink, changes: readonly SourceChange[]): SourceChange | null {
  // The exact record first; otherwise the same object within the same source. Never another source's record.
  return changes.find((change) => change.id === link.activityId)
    ?? (link.objectKey !== null ? changes.find((change) => change.objectKey === link.objectKey) : undefined)
    ?? null;
}

/** A NimiDay arrangement for another App's reminder: what to keep, so it can be found again. */
export function sourceLinkFor(change: SourceChange): SourceLink {
  return { appId: change.appId, appName: change.appName, activityId: change.id, objectKey: change.objectKey ?? null, title: change.title };
}

/** Followed, not set aside, one per business object, newest first. */
export function followedChanges(
  records: readonly ActivityRecordLike[],
  profile: DayProfile,
  circles: readonly CareCircle[],
): SourceChange[] {
  const hidden = new Set(profile.hiddenSourceIds);
  const newest = new Map<string, ActivityRecordLike>();
  const loose: ActivityRecordLike[] = [];
  for (const record of records) {
    const key = sameObjectKey(record);
    if (!key) {
      loose.push(record);
      continue;
    }
    const previous = newest.get(key);
    if (!previous || previous.occurredAt < record.occurredAt || (previous.occurredAt === record.occurredAt && previous.revision < record.revision)) {
      newest.set(key, record);
    }
  }
  const changes: SourceChange[] = [];
  for (const record of [...newest.values(), ...loose]) {
    if (hidden.has(record.activityId)) continue;
    const change = toSourceChange(record, profile, circles);
    if (!change || !sourcePreferenceFor(profile, change.appId).enabled) continue;
    changes.push(change);
  }
  return changes.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

function attentionRank(change: SourceChange): number {
  if (change.nature === 'reminder' && change.todoState === 'open') return 0;
  return change.unread ? 1 : 2;
}

/** What still needs doing comes first (open reminders, then unread), newest first within each group. */
export function attentionOrder(changes: readonly SourceChange[]): SourceChange[] {
  return changes.slice().sort((a, b) => attentionRank(a) - attentionRank(b)
    || (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}
