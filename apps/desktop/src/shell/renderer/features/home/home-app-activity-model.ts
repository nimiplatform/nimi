import {
  NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE,
  NimiAppActivityMergeState,
  type NimiAppActivityRecord,
  type NimiAppActivityViewSnapshot,
} from '@nimiplatform/sdk/app';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r035
export function isConversationReply(record: NimiAppActivityRecord): boolean {
  return record.source.kind === 'runtime-agent' && record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE;
}

export function unreadCompanionReplies(records: readonly NimiAppActivityRecord[]) {
  // Seeing a later reply in a companion's conversation catches up the older
  // replies there. Only the displayed turn needs an owner read write.
  const readThrough = new Map<string, string>();
  for (const record of records) {
    if (!isConversationReply(record) || record.userView.unread || !record.agent) continue;
    const ref = record.agent.agentRef;
    if (record.occurredAt > (readThrough.get(ref) ?? '')) readThrough.set(ref, record.occurredAt);
  }
  const byAgent = new Map<string, NimiAppActivityRecord[]>();
  for (const record of records) {
    if (!isConversationReply(record) || !record.userView.unread || !record.agent) continue;
    const ref = record.agent.agentRef;
    if (record.occurredAt < (readThrough.get(ref) ?? '')) continue;
    const replies = byAgent.get(ref);
    if (replies) replies.push(record);
    else byAgent.set(ref, [record]);
  }
  return byAgent;
}

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

export function messageCenterActivities(...views: readonly NimiAppActivityViewSnapshot[]) {
  return mergeActivitySnapshots(...views).filter(record => !isConversationReply(record));
}
