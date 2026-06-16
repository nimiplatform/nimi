import type { NimiRuntimeAgentCompanionParticipationProjection } from '@nimiplatform/sdk/runtime';

const ACCEPTED_COMPANION_SURFACE_KINDS = new Set([
  'avatar_companion',
  'avatar_persona',
  'avatar_debug',
]);

const ACCEPTED_COMPANION_TRIGGER_SOURCES = new Set([
  'user_explicit',
  'runtime_followup',
  'debug_workbench',
]);

const ACCEPTED_COMPANION_STATUSES = new Set([
  'pending',
  'running',
  'candidate_ready',
  'committed_by_owner',
]);

function projectionString(
  projection: Record<string, unknown>,
  key: string,
): string | null {
  const value = projection[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function assertAcceptedCompanionParticipationProjection(
  projection: NimiRuntimeAgentCompanionParticipationProjection,
): void {
  const record = projection as unknown as Record<string, unknown>;
  if (
    projection.status === 'blocked'
    || projection.status === 'failed'
    || projection.status === 'canceled'
  ) {
    throw new Error(projection.refusalReason || `companion participation ${projection.status}`);
  }
  const status = projectionString(record, 'status');
  if (!status || !ACCEPTED_COMPANION_STATUSES.has(status)) {
    throw new Error(`companion participation invalid status: ${status ?? '<missing>'}`);
  }
  const requiredFields = [
    'projectionId',
    'agentId',
    'profileRef',
    'roomOrchestrationRef',
    'auditRef',
    'conversationAnchorId',
    'turnId',
  ];
  for (const field of requiredFields) {
    if (!projectionString(record, field)) {
      throw new Error(`companion participation missing ${field}`);
    }
  }
  const surfaceKind = projectionString(record, 'surfaceKind');
  if (!surfaceKind || !ACCEPTED_COMPANION_SURFACE_KINDS.has(surfaceKind)) {
    throw new Error(`companion participation invalid surfaceKind: ${surfaceKind ?? '<missing>'}`);
  }
  const triggerSource = projectionString(record, 'triggerSource');
  if (!triggerSource || !ACCEPTED_COMPANION_TRIGGER_SOURCES.has(triggerSource)) {
    throw new Error(`companion participation invalid triggerSource: ${triggerSource ?? '<missing>'}`);
  }
  if (status === 'candidate_ready' && !projectionString(record, 'candidateRef')) {
    throw new Error('companion participation candidate_ready missing candidateRef');
  }
  if (status === 'committed_by_owner' && !projectionString(record, 'commitProjectionRef')) {
    throw new Error('companion participation committed_by_owner missing commitProjectionRef');
  }
}
