import {
  NimiAppActivityMergeState,
  type NimiAppActivityRecord,
  type NimiAppActivityViewSnapshot,
} from '@nimiplatform/sdk/app';

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

/**
 * Joins the open-todo and recent views into one projection. An activityId
 * present in both is taken at its highest change sequence before state or
 * unread is judged; the SDK merge state compares the decimal sequences
 * without converting them to Number.
 */
export function mergeActivitySnapshots(
  ...snapshots: readonly NimiAppActivityViewSnapshot[]
): readonly NimiAppActivityRecord[] {
  const merged = new NimiAppActivityMergeState();
  for (const snapshot of snapshots) {
    for (const record of snapshot.records) merged.mergeRecord(record);
  }
  return merged.list();
}
