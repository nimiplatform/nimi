// Relay context key — adapted from local-chat context-key.ts
// Removed: RuntimeRouteBinding import from mod SDK

export type LocalChatTurnContextSnapshot = {
  targetId: string;
  sessionId: string;
  routeBindingSource: string;
  routeBindingConnector: string;
  routeBindingModel: string;
};

type RouteBindingLike = {
  source?: string;
  connectorId?: string;
  model?: string;
};

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function resolveLogicalSessionId(input: {
  snapshot: LocalChatTurnContextSnapshot;
  activeSchedule?: LocalChatTurnContextSnapshot | null;
}): string {
  if (input.snapshot.sessionId) {
    return input.snapshot.sessionId;
  }
  if (input.activeSchedule
    && input.activeSchedule.targetId === input.snapshot.targetId
    && input.activeSchedule.sessionId) {
    return input.activeSchedule.sessionId;
  }
  return '';
}

export function buildLocalChatTurnContextSnapshot(input: {
  targetId?: string | null;
  sessionId?: string | null;
  routeBinding?: RouteBindingLike | null;
}): LocalChatTurnContextSnapshot {
  return {
    targetId: normalize(input.targetId),
    sessionId: normalize(input.sessionId),
    routeBindingSource: normalize(input.routeBinding?.source),
    routeBindingConnector: normalize(input.routeBinding?.connectorId),
    routeBindingModel: normalize(input.routeBinding?.model),
  };
}

export function buildLocalChatTurnContextKey(input: {
  targetId?: string | null;
  sessionId?: string | null;
  routeBinding?: RouteBindingLike | null;
  activeSchedule?: LocalChatTurnContextSnapshot | null;
}): string {
  const snapshot = buildLocalChatTurnContextSnapshot(input);
  const logicalSessionId = resolveLogicalSessionId({
    snapshot,
    activeSchedule: input.activeSchedule || null,
  });
  return [snapshot.targetId, logicalSessionId].join('|');
}

export function shouldCancelForTurnContextChange(input: {
  previous: LocalChatTurnContextSnapshot | null;
  next: LocalChatTurnContextSnapshot;
  activeSchedule: LocalChatTurnContextSnapshot | null;
}): boolean {
  if (!input.previous) {
    return false;
  }
  if (input.previous.targetId !== input.next.targetId) {
    return true;
  }
  const activeSchedule = input.activeSchedule;
  if (!activeSchedule || activeSchedule.targetId !== input.next.targetId) {
    return false;
  }
  const nextSessionId = input.next.sessionId;
  if (!nextSessionId || nextSessionId === activeSchedule.sessionId) {
    return false;
  }
  return true;
}
