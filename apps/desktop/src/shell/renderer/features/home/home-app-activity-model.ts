import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';

export type HomeActivityFacet = Readonly<{
  key: string;
  kind: 'source' | 'agent';
  label: string;
  count: number;
}>;

export type HomeActivityDayGroup = Readonly<{
  dayKey: string;
  relative: 'today' | 'yesterday' | null;
  day: Date;
  records: readonly NimiAppActivityRecord[];
}>;

/** Display name of the record's source; Runtime-origin records are shown by their Agent. */
export function activitySourceLabel(record: NimiAppActivityRecord): string | null {
  if (record.source.kind === 'runtime-agent') return record.agent?.displayName || null;
  return record.source.displayName || record.source.appId || null;
}

export function isPendingTodo(record: NimiAppActivityRecord): boolean {
  return record.kind === 'todo' && record.todoState === 'open';
}

/** Only records with an App-owned source object offer an open action. */
export function isOpenable(record: NimiAppActivityRecord): boolean {
  return record.source.kind === 'app' && record.objectRef !== null;
}

export function activityFacets(records: readonly NimiAppActivityRecord[]): HomeActivityFacet[] {
  const facets = new Map<string, { kind: 'source' | 'agent'; label: string; count: number }>();
  const add = (key: string, kind: 'source' | 'agent', label: string | null) => {
    if (!label) return;
    const current = facets.get(key);
    facets.set(key, { kind, label, count: (current?.count ?? 0) + 1 });
  };
  for (const record of records) {
    if (record.source.kind === 'app') add(`source:${record.source.sourceRef}`, 'source', activitySourceLabel(record));
    if (record.agent) add(`agent:${record.agent.agentRef}`, 'agent', record.agent.displayName);
  }
  return [...facets.entries()]
    .map(([key, facet]) => ({ key, ...facet }))
    .sort((left, right) => (
      left.kind.localeCompare(right.kind) || right.count - left.count || left.label.localeCompare(right.label)
    ));
}

export function applyActivityFacet(
  records: readonly NimiAppActivityRecord[],
  facetKey: string | null,
): readonly NimiAppActivityRecord[] {
  if (!facetKey) return records;
  if (facetKey.startsWith('source:')) {
    const sourceRef = facetKey.slice('source:'.length);
    return records.filter((record) => record.source.kind === 'app' && record.source.sourceRef === sourceRef);
  }
  const agentRef = facetKey.slice('agent:'.length);
  return records.filter((record) => record.agent?.agentRef === agentRef);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Groups records by the local day they occurred on. Publication or delivery
 * time never moves a record into a later day.
 */
export function groupByOccurredDay(records: readonly NimiAppActivityRecord[], now: Date): HomeActivityDayGroup[] {
  const today = localDayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = localDayKey(yesterdayDate);
  const groups = new Map<string, { day: Date; records: NimiAppActivityRecord[] }>();
  for (const record of records) {
    const occurred = new Date(record.occurredAt);
    const key = localDayKey(occurred);
    const group = groups.get(key) ?? { day: new Date(occurred.getFullYear(), occurred.getMonth(), occurred.getDate()), records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dayKey, group]) => ({
      dayKey,
      relative: dayKey === today ? 'today' : dayKey === yesterday ? 'yesterday' : null,
      day: group.day,
      records: group.records,
    }));
}
