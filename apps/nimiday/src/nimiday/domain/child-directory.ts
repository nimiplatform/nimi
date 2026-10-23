import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import { PARENTOS_APP_ID, type SourceApp, type SourceGroup } from './sources.js';

export const CHILD_DIRECTORY_TYPE = 'nimi.parentos.child-directory.v1';
export type ChildDirectory = {
  readonly groups: readonly SourceGroup[];
  readonly sources: number;
  readonly invalid: boolean;
  readonly unavailable: boolean;
  readonly latestAt: string;
};

// @nimi-authority: rule.nimi.nimiday.assistant.child-source-addition
/** Reject a malformed whole snapshot; partial identity is never a complete list. */
export function childDirectory(records: readonly NimiAppActivityRecord[]): ChildDirectory {
  const snapshots = new Map<string, NimiAppActivityRecord>();
  let invalid = false;
  for (const record of records) {
    if (record.source.kind !== 'app' || record.source.appId !== PARENTOS_APP_ID || record.type !== CHILD_DIRECTORY_TYPE) continue;
    const sourceRef = record.source.sourceRef;
    if (!sourceRef || sourceRef.includes('\0')) { invalid = true; continue; }
    const previous = snapshots.get(sourceRef);
    if (!previous || BigInt(record.changeSeq) > BigInt(previous.changeSeq)) snapshots.set(sourceRef, record);
  }
  const groups: SourceGroup[] = [];
  let latestAt = '';
  let unavailable = false;
  for (const [sourceRef, record] of snapshots) {
    const rows = record.data?.children;
    const ids = new Set<string>();
    const valid = record.key === 'child-directory' && record.kind === 'activity' && Array.isArray(rows)
      && rows.every(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)
          || typeof row.childId !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/u.test(row.childId)
          || typeof row.childName !== 'string' || !row.childName.trim() || ids.has(row.childId)) return false;
        ids.add(row.childId);
        return true;
      });
    if (!valid) { invalid = true; continue; }
    unavailable ||= !record.source.available;
    latestAt = latestAt > record.updatedAt ? latestAt : record.updatedAt;
    for (const row of rows as { childId: string; childName: string }[]) {
      groups.push({
        key: `${sourceRef}\0child:${row.childId}`,
        child: { sourceRef, childId: row.childId, childName: row.childName.trim() },
        count: 0, examples: [], firstAt: record.updatedAt, available: record.source.available,
      });
    }
  }
  return { groups, sources: snapshots.size, invalid, unavailable, latestAt };
}

/** All discovery entry points use the directory, including children with no records. */
export function withChildDirectory(apps: readonly SourceApp[], directory: ChildDirectory): SourceApp[] {
  const existing = apps.find(app => app.appId === PARENTOS_APP_ID);
  const other = apps.filter(app => app.appId !== PARENTOS_APP_ID);
  if (!existing && !directory.sources) return other;
  return [...other, {
    appId: PARENTOS_APP_ID, appName: existing?.appName ?? 'ParentOS',
    count: existing?.count ?? 0, latestAt: directory.latestAt || existing?.latestAt || '',
    ungrouped: existing?.ungrouped ?? { count: 0, examples: [] },
    groups: directory.groups.map(group => {
      const reminders = existing?.groups.find(candidate => candidate.key === group.key);
      return { ...group, count: reminders?.count ?? 0, examples: reminders?.examples ?? [] };
    }),
  }];
}
