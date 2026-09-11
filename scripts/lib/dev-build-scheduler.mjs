export function quietBuildDelayMs({ now, lastChangeAt, lastBuildCompletedAt, quietMs }) {
  const quietSince = Math.max(lastChangeAt || 0, lastBuildCompletedAt || 0);
  if (quietSince <= 0) return 0;
  return Math.max(0, quietSince + quietMs - now);
}

export function stableBuildSurfaces(plan, revisionsBefore, revisionsAfter, metadataOnlySurfaces = []) {
  const metadataOnly = new Set(metadataOnlySurfaces);
  return plan.filter(
    (surface) => (revisionsBefore[surface] ?? 0) === (revisionsAfter[surface] ?? 0)
      || metadataOnly.has(surface),
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
// when every pending event is non-structural, its content was observed by the
// last build, and its mtime predates the notification by the save grace window.
// Measuring that grace from the build would permanently rebuild a file saved
// just before the build whenever Windows flushes a delayed access timestamp.
export function findMetadataOnlySurfaces(pendingBySurface, baselines, graceMs) {
  const droppable = [];
  for (const [surface, pending] of pendingBySurface) {
    if (!pending || pending.structural) continue;
    const baseline = baselines[surface] ?? 0;
    if (!(baseline > 0)) continue;
    if (pending.newestMtimeMs <= baseline
      && pending.newestMtimeMs + graceMs <= pending.oldestObservedAtMs) {
      droppable.push(surface);
    }
  }
  return droppable;
}
