import type { AgentCenterSnapshot } from '@nimiplatform/kit/features/agent-center';

// Placement readiness is scoped to the target presentation surface. An
// unrelated Memory/Cognition read may degrade the wider AgentCenter without
// invalidating the current Agent, presentation, or replace capability.
export function isZhiyuResourcePackPlacementReady(
  snapshot: AgentCenterSnapshot | null,
): boolean {
  if (!snapshot || snapshot.phase === 'loading') return false;
  const appearance = snapshot.state.appearance;
  return snapshot.availability.replaceAppearance.state === 'available'
    && appearance.status !== 'loading'
    && appearance.status !== 'invalid'
    && typeof appearance.presentationRevision === 'string'
    && appearance.presentationRevision.length > 0;
}
