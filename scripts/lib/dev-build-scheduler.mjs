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
