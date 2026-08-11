export function quietBuildDelayMs({ now, lastChangeAt, lastBuildCompletedAt, quietMs }) {
  const quietSince = Math.max(lastChangeAt || 0, lastBuildCompletedAt || 0);
  if (quietSince <= 0) return 0;
  return Math.max(0, quietSince + quietMs - now);
}

export function stableBuildSurfaces(plan, revisionsBefore, revisionsAfter) {
  return plan.filter(
    (surface) => (revisionsBefore[surface] ?? 0) === (revisionsAfter[surface] ?? 0),
  );
}

export function classifyWatchEventMetadata({ eventType, nodeKind, mtimeMs }) {
  if (eventType === 'rename' || (nodeKind !== 'file' && nodeKind !== 'directory')) {
    return { structural: true };
  }
  return { structural: false, mtimeMs };
}

// Watched files can emit change events without any content edit: on Windows,
// deferred last-access-time flushes surface as change notifications when a
// reader such as tsc or Vite touches a source file. A surface is safe to skip
// when every pending event is a non-structural file event whose mtime predates
// the last build that observed the surface (with a grace window for save
// patterns whose mtime slightly trails the event, such as atomic renames).
export function findMetadataOnlySurfaces(pendingBySurface, baselines, graceMs) {
  const droppable = [];
  for (const [surface, pending] of pendingBySurface) {
    if (!pending || pending.structural) continue;
    const baseline = baselines[surface] ?? 0;
    if (!(baseline > 0)) continue;
    if (pending.newestMtimeMs + graceMs <= baseline) droppable.push(surface);
  }
  return droppable;
}
