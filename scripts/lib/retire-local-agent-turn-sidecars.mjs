// Offline removal of a retired turn-display projection, never a runtime reader.
export function retireLocalAgentTurnSidecars(raw) {
  const anchor = JSON.parse(raw);
  const snapshots = [anchor.lastTurnSnapshot, ...Object.values(anchor.completedTurnSnapshots ?? {})];
  let removed = 0;
  const keys = ['CanceledHookIDs', 'Message', 'ReasonCode', 'ScheduledHookID', 'Status', 'StatusText'];
  for (const snapshot of snapshots) {
    if (!snapshot || !Object.hasOwn(snapshot, 'sidecar')) continue;
    const sidecar = snapshot.sidecar;
    if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar) ||
        JSON.stringify(Object.keys(sidecar).sort()) !== JSON.stringify(keys) ||
        !['applied', 'failed', 'skipped'].includes(sidecar.Status) ||
        !['Message', 'ScheduledHookID', 'StatusText'].every(k => typeof sidecar[k] === 'string') ||
        !Number.isInteger(sidecar.ReasonCode) ||
        !(sidecar.CanceledHookIDs === null || Array.isArray(sidecar.CanceledHookIDs) && sidecar.CanceledHookIDs.every(x => typeof x === 'string')))
      throw new Error('Unknown turn sidecar format requires separate review.');
    // Canonical turn text, media, committed transcript and follow-up rows stay intact.
    delete snapshot.sidecar;
    removed++;
  }
  return { removed, after: removed ? JSON.stringify(anchor) : raw };
}

// The per-anchor follow-up switch was retired in favor of Agent-owned contact
// permission. Only explicit OFF values qualify; never infer a permission grant.
export function retireDisabledFollowUpPreferences(raw) {
  const anchor = JSON.parse(raw);
  if (!Object.hasOwn(anchor, 'followUpEnabled') && !Object.hasOwn(anchor, 'followUpPolicyRevision'))
    return { removed: false, after: raw };
  if (anchor.followUpEnabled !== false || !Number.isSafeInteger(anchor.followUpPolicyRevision) || anchor.followUpPolicyRevision < 0)
    throw new Error('Active or unknown retired follow-up preference requires separate review.');
  delete anchor.followUpEnabled;
  delete anchor.followUpPolicyRevision;
  return { removed: true, after: JSON.stringify(anchor) };
}
