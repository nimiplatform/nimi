import { normalizeText } from './helpers.js';
import type {
  RuntimeAgentConsumeEvent,
  RuntimeAgentSessionTurnSnapshot,
} from './types-runtime-agent.js';

export type RuntimeAgentProjectionSummary = {
  eventName: string;
  localAgentRef: string;
  conversationAnchorId: string | null;
  runtimeTurnId: string | null;
  runtimeStreamId: string | null;
  detail: Record<string, unknown>;
};

export type RuntimeAgentTimelineSummary = {
  turnId: string;
  streamId: string;
  channel: string;
  offsetMs: number;
  sequence: number;
  startedAtWall: string;
  observedAtWall: string;
  timebaseOwner: string;
  projectionRuleId: string;
  clockBasis: string;
  providerNeutral: boolean;
  appLocalAuthority: boolean;
};

export type RuntimeAgentSnapshotRecoveryRequestContext = {
  ownerUserId?: string;
  realmAgentId?: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId?: string;
};

export type RuntimeAgentSnapshotRecoveryLogEvent = {
  level: 'warn';
  area: string;
  message: `action:${string}` | `phase:${string}`;
  details: Record<string, unknown>;
};

export type RuntimeAgentSnapshotRecoveryResult = 'none' | 'bound' | 'terminal';

export function isRuntimeAgentProjectionEvent(event: RuntimeAgentConsumeEvent): boolean {
  return event.eventName.startsWith('runtime.agent.state.')
    || event.eventName.startsWith('runtime.agent.hook.')
    || event.eventName.startsWith('runtime.agent.presentation.');
}

export function matchesRuntimeAgentProjectionScope(input: {
  event: RuntimeAgentConsumeEvent;
  conversationAnchorId: string;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
}): boolean {
  const eventRecord = input.event as RuntimeAgentConsumeEvent & {
    conversationAnchorId?: string;
    originatingTurnId?: string;
    turnId?: string;
  };
  const eventAnchorId = normalizeText(eventRecord.conversationAnchorId);
  if (eventAnchorId && eventAnchorId !== input.conversationAnchorId) {
    return false;
  }
  const originTurnId = normalizeText(eventRecord.originatingTurnId);
  if (originTurnId) {
    return input.currentTurnAccepted && originTurnId === input.currentRuntimeTurnId;
  }
  const presentationTurnId = normalizeText(eventRecord.turnId);
  if (presentationTurnId) {
    return input.currentTurnAccepted && presentationTurnId === input.currentRuntimeTurnId;
  }
  return true;
}

export function summarizeRuntimeAgentProjectionEvent(event: RuntimeAgentConsumeEvent): RuntimeAgentProjectionSummary {
  const eventRecord = event as RuntimeAgentConsumeEvent & {
    conversationAnchorId?: string;
    originatingTurnId?: string;
    originatingStreamId?: string;
    turnId?: string;
    streamId?: string;
    detail?: Record<string, unknown>;
  };
  return {
    eventName: event.eventName,
    localAgentRef: normalizeText(eventRecord.localAgentRef),
    conversationAnchorId: normalizeText(eventRecord.conversationAnchorId) || null,
    runtimeTurnId: normalizeText(eventRecord.originatingTurnId) || normalizeText(eventRecord.turnId) || null,
    runtimeStreamId: normalizeText(eventRecord.originatingStreamId) || normalizeText(eventRecord.streamId) || null,
    detail: eventRecord.detail && typeof eventRecord.detail === 'object' && !Array.isArray(eventRecord.detail)
      ? eventRecord.detail
      : {},
  };
}

export function summarizeRuntimeAgentTimeline(event: RuntimeAgentConsumeEvent): RuntimeAgentTimelineSummary | null {
  const timeline = (event as RuntimeAgentConsumeEvent & {
    timeline?: {
      turnId?: unknown;
      streamId?: unknown;
      channel?: unknown;
      offsetMs?: unknown;
      sequence?: unknown;
      startedAtWall?: unknown;
      observedAtWall?: unknown;
      timebaseOwner?: unknown;
      projectionRuleId?: unknown;
      clockBasis?: unknown;
      providerNeutral?: unknown;
      appLocalAuthority?: unknown;
    };
  }).timeline;
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
    return null;
  }
  return {
    turnId: normalizeText(timeline.turnId),
    streamId: normalizeText(timeline.streamId),
    channel: normalizeText(timeline.channel),
    offsetMs: Number(timeline.offsetMs),
    sequence: Number(timeline.sequence),
    startedAtWall: normalizeText(timeline.startedAtWall),
    observedAtWall: normalizeText(timeline.observedAtWall),
    timebaseOwner: normalizeText(timeline.timebaseOwner),
    projectionRuleId: normalizeText(timeline.projectionRuleId),
    clockBasis: normalizeText(timeline.clockBasis),
    providerNeutral: timeline.providerNeutral === true,
    appLocalAuthority: timeline.appLocalAuthority === true,
  };
}

export function readRuntimeAgentStructuredMessageField(
  structured: Record<string, unknown> | undefined,
  field: 'message_id' | 'text',
): string {
  const message = structured && typeof structured.message === 'object' && structured.message !== null
    ? structured.message as Record<string, unknown>
    : {};
  const value = message[field];
  return typeof value === 'string' ? normalizeText(value) : '';
}

export function runtimeAgentSnapshotTurnIsCompleted(turn: RuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'completed' || Boolean(normalizeText(turn.finishReason));
}

export function runtimeAgentSnapshotTurnIsFailed(turn: RuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'failed' || Boolean(normalizeText(turn.reasonCode));
}

export function runtimeAgentSnapshotTurnIsTerminal(
  turn: RuntimeAgentSessionTurnSnapshot | undefined,
): turn is RuntimeAgentSessionTurnSnapshot {
  return Boolean(turn && (runtimeAgentSnapshotTurnIsCompleted(turn) || runtimeAgentSnapshotTurnIsFailed(turn)));
}

export function runtimeAgentSnapshotCompletedTurnHasRecoverableContent(
  turn: RuntimeAgentSessionTurnSnapshot,
): boolean {
  if (!runtimeAgentSnapshotTurnIsCompleted(turn)) {
    return true;
  }
  return Boolean(
    turn.structured
      && (normalizeText(turn.text) || readRuntimeAgentStructuredMessageField(turn.structured, 'text')),
  );
}

export function buildRuntimeAgentSnapshotRecoveryEvents(options: {
  turn: RuntimeAgentSessionTurnSnapshot;
  ownerUserId?: string;
  realmAgentId?: string;
  localAgentRef: string;
  conversationAnchorId: string;
  requestId: string;
  requestMessageId: string;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
  currentRuntimeStreamId: string;
  hasStructuredEnvelope: boolean;
  hasCommittedMessage: boolean;
}): RuntimeAgentConsumeEvent[] {
  const runtimeTurnId = normalizeText(options.turn.turnId);
  if (!runtimeTurnId) {
    return [];
  }
  const streamId = options.currentRuntimeStreamId || `snapshot:${runtimeTurnId}`;
  const structured = options.turn.structured && Object.keys(options.turn.structured).length > 0
    ? options.turn.structured
    : undefined;
  const text = normalizeText(options.turn.text) || readRuntimeAgentStructuredMessageField(structured, 'text');
  const messageId = normalizeText(options.turn.messageId)
    || readRuntimeAgentStructuredMessageField(structured, 'message_id')
    || options.requestMessageId
    || 'message-0';
  const events: RuntimeAgentConsumeEvent[] = [];
  if (!options.currentTurnAccepted || options.currentRuntimeTurnId !== runtimeTurnId) {
    events.push({
      eventName: 'runtime.agent.turn.accepted',
      ownerUserId: options.ownerUserId,
      realmAgentId: options.realmAgentId,
      localAgentRef: options.localAgentRef,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: { requestId: options.requestId },
    } as RuntimeAgentConsumeEvent);
  }
  if (!options.hasStructuredEnvelope && structured) {
    events.push({
      eventName: 'runtime.agent.turn.structured',
      ownerUserId: options.ownerUserId,
      realmAgentId: options.realmAgentId,
      localAgentRef: options.localAgentRef,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        kind: normalizeText(String(structured.schema_id || '')) || 'agent_resolved_message_action_envelope',
        payload: structured,
      },
    } as RuntimeAgentConsumeEvent);
  }
  if (!options.hasCommittedMessage && text) {
    events.push({
      eventName: 'runtime.agent.turn.message_committed',
      ownerUserId: options.ownerUserId,
      realmAgentId: options.realmAgentId,
      localAgentRef: options.localAgentRef,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      messageId,
      detail: { messageId, text },
    } as RuntimeAgentConsumeEvent);
  }
  if (runtimeAgentSnapshotTurnIsCompleted(options.turn)) {
    events.push({
      eventName: 'runtime.agent.turn.completed',
      ownerUserId: options.ownerUserId,
      realmAgentId: options.realmAgentId,
      localAgentRef: options.localAgentRef,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        terminalReason: normalizeText(options.turn.finishReason) || 'stop',
      },
    } as RuntimeAgentConsumeEvent);
    return events;
  }
  if (runtimeAgentSnapshotTurnIsFailed(options.turn)) {
    events.push({
      eventName: 'runtime.agent.turn.failed',
      ownerUserId: options.ownerUserId,
      realmAgentId: options.realmAgentId,
      localAgentRef: options.localAgentRef,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        reasonCode: normalizeText(options.turn.reasonCode) || 'RUNTIME_AGENT_TURN_FAILED',
        message: normalizeText(options.turn.message) || undefined,
      },
    } as RuntimeAgentConsumeEvent);
  }
  return events;
}

export async function recoverRuntimeAgentTerminalSnapshot(options: {
  reason: string;
  request: RuntimeAgentSnapshotRecoveryRequestContext;
  requestId: string;
  requestMessageId: string;
  requestStartedAtMs: number;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
  currentRuntimeStreamId: string;
  hasStructuredEnvelope: boolean;
  hasCommittedMessage: boolean;
  querySnapshot: () => Promise<{
    activeTurn?: RuntimeAgentSessionTurnSnapshot;
    lastTurn?: RuntimeAgentSessionTurnSnapshot;
  }>;
  enqueue: (event: RuntimeAgentConsumeEvent) => void;
  logEvent: (event: RuntimeAgentSnapshotRecoveryLogEvent) => void;
}): Promise<RuntimeAgentSnapshotRecoveryResult> {
  let activeTurn: RuntimeAgentSessionTurnSnapshot | undefined;
  let turn: RuntimeAgentSessionTurnSnapshot | undefined;
  try {
    const snapshot = await options.querySnapshot();
    activeTurn = snapshot.activeTurn;
    turn = snapshot.lastTurn;
  } catch (error) {
    options.logEvent({
      level: 'warn',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-recovery-query-failed',
      details: {
        agentId: options.request.localAgentRef,
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId || null,
        requestId: options.requestId,
        reason: options.reason,
        error: String(error instanceof Error ? error.message : error),
      },
    });
    return 'none';
  }
  const activeTurnId = normalizeText(activeTurn?.turnId);
  if (!options.currentTurnAccepted && activeTurnId) {
    const streamId = options.currentRuntimeStreamId || `snapshot:${activeTurnId}`;
    options.logEvent({
      level: 'warn',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-active-turn-bound',
      details: {
        agentId: options.request.localAgentRef,
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId || null,
        requestId: options.requestId,
        runtimeTurnId: activeTurnId,
        status: normalizeText(activeTurn?.status) || null,
      },
    });
    options.enqueue({
      eventName: 'runtime.agent.turn.accepted',
      ownerUserId: options.request.ownerUserId,
      realmAgentId: options.request.realmAgentId,
      localAgentRef: options.request.localAgentRef,
      conversationAnchorId: options.request.conversationAnchorId,
      turnId: activeTurnId,
      streamId,
      detail: { requestId: options.requestId },
    } as RuntimeAgentConsumeEvent);
    return 'bound';
  }
  const turnUpdatedAtMs = Date.parse(normalizeText(turn?.updatedAt));
  const terminalAfterRequest = Number.isFinite(turnUpdatedAtMs)
    && Number.isFinite(options.requestStartedAtMs)
    && turnUpdatedAtMs >= options.requestStartedAtMs - 1000;
  if (!options.currentTurnAccepted && runtimeAgentSnapshotTurnIsTerminal(turn) && terminalAfterRequest) {
    if (!runtimeAgentSnapshotCompletedTurnHasRecoverableContent(turn)) {
      return 'none';
    }
    const events = buildRuntimeAgentSnapshotRecoveryEvents({
      turn,
      ownerUserId: options.request.ownerUserId,
      realmAgentId: options.request.realmAgentId,
      localAgentRef: options.request.localAgentRef,
      conversationAnchorId: options.request.conversationAnchorId,
      requestId: options.requestId,
      requestMessageId: options.requestMessageId,
      currentTurnAccepted: false,
      currentRuntimeTurnId: '',
      currentRuntimeStreamId: options.currentRuntimeStreamId,
      hasStructuredEnvelope: options.hasStructuredEnvelope,
      hasCommittedMessage: options.hasCommittedMessage,
    });
    if (events.length === 0) {
      return 'none';
    }
    options.logEvent({
      level: 'warn',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-recovered',
      details: {
        agentId: options.request.localAgentRef,
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId || null,
        requestId: options.requestId,
        reason: options.reason,
        runtimeTurnId: turn.turnId,
        status: normalizeText(turn.status) || null,
        finishReason: normalizeText(turn.finishReason) || null,
        recoveredWithoutAcceptedEvent: true,
      },
    });
    for (const event of events) {
      options.enqueue(event);
    }
    return 'terminal';
  }
  if (!runtimeAgentSnapshotTurnIsTerminal(turn)) {
    return 'none';
  }
  if (!options.currentTurnAccepted || normalizeText(turn.turnId) !== options.currentRuntimeTurnId) {
    return 'none';
  }
  if (!runtimeAgentSnapshotCompletedTurnHasRecoverableContent(turn)) {
    return 'none';
  }
  const events = buildRuntimeAgentSnapshotRecoveryEvents({
    turn,
    ownerUserId: options.request.ownerUserId,
    realmAgentId: options.request.realmAgentId,
    localAgentRef: options.request.localAgentRef,
    conversationAnchorId: options.request.conversationAnchorId,
    requestId: options.requestId,
    requestMessageId: options.requestMessageId,
    currentTurnAccepted: options.currentTurnAccepted,
    currentRuntimeTurnId: options.currentRuntimeTurnId,
    currentRuntimeStreamId: options.currentRuntimeStreamId,
    hasStructuredEnvelope: options.hasStructuredEnvelope,
    hasCommittedMessage: options.hasCommittedMessage,
  });
  if (events.length === 0) {
    return 'none';
  }
  options.logEvent({
    level: 'warn',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:snapshot-recovered',
    details: {
      agentId: options.request.localAgentRef,
      conversationAnchorId: options.request.conversationAnchorId,
      threadId: options.request.threadId || null,
      requestId: options.requestId,
      reason: options.reason,
      runtimeTurnId: turn.turnId,
      status: normalizeText(turn.status) || null,
      finishReason: normalizeText(turn.finishReason) || null,
      reasonCode: normalizeText(turn.reasonCode) || null,
      hasStructured: Boolean(turn.structured),
      hasText: Boolean(
        normalizeText(turn.text) || readRuntimeAgentStructuredMessageField(turn.structured, 'text'),
      ),
      eventCount: events.length,
      recoveredWithoutAcceptedEvent: false,
    },
  });
  for (const event of events) {
    options.enqueue(event);
  }
  return 'terminal';
}
