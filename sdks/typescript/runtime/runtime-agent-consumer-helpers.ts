import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume-types';
import type { JsonObject } from '../types';
import { parseNimiRuntimeAgentStructuredMessageActionEnvelope } from './runtime-agent-message-action';
import type {
  NimiRuntimeAgentProjectionSummary,
  NimiRuntimeAgentSnapshotRecoveryLogEvent,
  NimiRuntimeAgentSnapshotRecoveryRequestContext,
  NimiRuntimeAgentSnapshotRecoveryResult,
  NimiRuntimeAgentTimelineSummary,
} from './runtime-agent-turn-runner-types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isNimiRuntimeAgentProjectionEvent(event: NimiRuntimeAgentConsumeEvent): boolean {
  return event.eventName.startsWith('runtime.agent.state.')
    || event.eventName.startsWith('runtime.agent.hook.')
    || event.eventName.startsWith('runtime.agent.presentation.');
}

export function matchesNimiRuntimeAgentProjectionScope(input: {
  readonly event: NimiRuntimeAgentConsumeEvent;
  readonly conversationAnchorId: string;
  readonly currentTurnAccepted: boolean;
  readonly currentRuntimeTurnId: string;
}): boolean {
  const eventRecord = input.event as NimiRuntimeAgentConsumeEvent & {
    readonly conversationAnchorId?: string;
    readonly originatingTurnId?: string;
    readonly turnId?: string;
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

export function summarizeNimiRuntimeAgentProjectionEvent(
  event: NimiRuntimeAgentConsumeEvent,
): NimiRuntimeAgentProjectionSummary {
  const eventRecord = event as NimiRuntimeAgentConsumeEvent & {
    readonly conversationAnchorId?: string;
    readonly originatingTurnId?: string;
    readonly originatingStreamId?: string;
    readonly turnId?: string;
    readonly streamId?: string;
    readonly detail?: JsonObject;
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

export function summarizeNimiRuntimeAgentTimeline(
  event: NimiRuntimeAgentConsumeEvent,
): NimiRuntimeAgentTimelineSummary | null {
  const timeline = event.timeline;
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
    appLocalAuthority: Boolean(timeline.appLocalAuthority),
  };
}

export function readNimiRuntimeAgentStructuredMessageField(
  structured: JsonObject | undefined,
  field: 'message_id' | 'text',
): string {
  const message = structured && typeof structured.message === 'object' && structured.message !== null
    ? structured.message as JsonObject
    : {};
  const value = message[field];
  return typeof value === 'string' ? normalizeText(value) : '';
}

export function nimiRuntimeAgentSnapshotTurnIsCompleted(turn: NimiRuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'completed' || Boolean(normalizeText(turn.finishReason));
}

export function nimiRuntimeAgentSnapshotTurnIsFailed(turn: NimiRuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'failed' || Boolean(normalizeText(turn.reasonCode));
}

export function nimiRuntimeAgentSnapshotTurnIsTerminal(
  turn: NimiRuntimeAgentSessionTurnSnapshot | undefined,
): turn is NimiRuntimeAgentSessionTurnSnapshot {
  return Boolean(turn && (
    nimiRuntimeAgentSnapshotTurnIsCompleted(turn)
    || nimiRuntimeAgentSnapshotTurnIsFailed(turn)
  ));
}

export function nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent(
  turn: NimiRuntimeAgentSessionTurnSnapshot,
): boolean {
  if (!nimiRuntimeAgentSnapshotTurnIsCompleted(turn)) {
    return true;
  }
  return Boolean(
    turn.structured
      && (normalizeText(turn.text) || readNimiRuntimeAgentStructuredMessageField(turn.structured, 'text')),
  );
}

export function buildNimiRuntimeAgentSnapshotRecoveryEvents(options: {
  readonly turn: NimiRuntimeAgentSessionTurnSnapshot;
  readonly ownerUserId?: unknown;
  readonly runtimeSourceRef?: unknown;
  readonly localAgentRef: unknown;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly currentTurnAccepted: boolean;
  readonly currentRuntimeTurnId: string;
  readonly currentRuntimeStreamId: string;
  readonly hasStructuredEnvelope: boolean;
  readonly hasCommittedMessage: boolean;
  readonly allowSnapshotStreamId?: boolean;
}): NimiRuntimeAgentConsumeEvent[] {
  const runtimeTurnId = normalizeText(options.turn.turnId);
  if (!runtimeTurnId) {
    return [];
  }
  const streamId = normalizeText(options.currentRuntimeStreamId)
    || normalizeText(options.turn.streamId)
    || (options.allowSnapshotStreamId === true ? `snapshot:${runtimeTurnId}` : '');
  if (!streamId) {
    return [];
  }
  const structured = options.turn.structured && Object.keys(options.turn.structured).length > 0
    ? options.turn.structured
    : undefined;
  const text = normalizeText(options.turn.text) || readNimiRuntimeAgentStructuredMessageField(structured, 'text');
  const messageId = normalizeText(options.turn.messageId)
    || readNimiRuntimeAgentStructuredMessageField(structured, 'message_id');
  const events: NimiRuntimeAgentConsumeEvent[] = [];
  if (!options.currentTurnAccepted || options.currentRuntimeTurnId !== runtimeTurnId) {
    events.push({
      eventName: 'runtime.agent.turn.accepted',
      localAgentRef: normalizeText(options.localAgentRef),
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: { requestId: options.requestId },
    } as NimiRuntimeAgentConsumeEvent);
  }
  if (!options.hasStructuredEnvelope && structured) {
    events.push({
      eventName: 'runtime.agent.turn.structured',
      localAgentRef: normalizeText(options.localAgentRef),
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        kind: normalizeText(String(structured.schema_id || '')) || 'agent_resolved_message_action_envelope',
        payload: structured,
      },
    } as NimiRuntimeAgentConsumeEvent);
  }
  if (!options.hasCommittedMessage && text) {
    if (!messageId) {
      return [];
    }
    events.push({
      eventName: 'runtime.agent.turn.message_committed',
      localAgentRef: normalizeText(options.localAgentRef),
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: { messageId, text },
    } as NimiRuntimeAgentConsumeEvent);
  }
  if (nimiRuntimeAgentSnapshotTurnIsCompleted(options.turn)) {
    const terminalReason = normalizeText(options.turn.finishReason);
    if (!terminalReason) {
      return [];
    }
    const reasonCode = normalizeText(options.turn.reasonCode);
    if (reasonCode && structured) {
      try {
        const envelope = parseNimiRuntimeAgentStructuredMessageActionEnvelope(structured);
        const failedAction = envelope.actions.find((action) => (
          action.modality === 'image' && action.operation === 'image.generate'
        ));
        if (failedAction) {
          events.push({
            eventName: 'runtime.agent.turn.action_failed',
            localAgentRef: normalizeText(options.localAgentRef),
            conversationAnchorId: options.conversationAnchorId,
            turnId: runtimeTurnId,
            streamId,
            detail: {
              actionId: failedAction.actionId,
              modality: failedAction.modality,
              operation: failedAction.operation,
              projectionMessageId: `${runtimeTurnId}:message:${failedAction.actionIndex + 1}`,
              reasonCode,
              reason: 'image_execution_failed',
              message: normalizeText(options.turn.message) || 'Image generation failed.',
            },
          } as NimiRuntimeAgentConsumeEvent);
        }
      } catch {
        // A malformed structured snapshot cannot safely identify the failed
        // action. Preserve the terminal turn projection without guessing.
      }
    }
    events.push({
      eventName: 'runtime.agent.turn.completed',
      localAgentRef: normalizeText(options.localAgentRef),
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: { terminalReason },
    } as NimiRuntimeAgentConsumeEvent);
    return events;
  }
  if (nimiRuntimeAgentSnapshotTurnIsFailed(options.turn)) {
    events.push({
      eventName: 'runtime.agent.turn.failed',
      localAgentRef: normalizeText(options.localAgentRef),
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        reasonCode: normalizeText(options.turn.reasonCode) || 'RUNTIME_AGENT_TURN_FAILED',
        message: normalizeText(options.turn.message) || undefined,
      },
    } as NimiRuntimeAgentConsumeEvent);
  }
  return events;
}

export async function recoverNimiRuntimeAgentTerminalSnapshot(options: {
  readonly reason: string;
  readonly request: NimiRuntimeAgentSnapshotRecoveryRequestContext;
  readonly requestId: string;
  readonly requestMessageId: string;
  readonly requestStartedAtMs: number;
  readonly currentTurnAccepted: boolean;
  readonly currentRuntimeTurnId: string;
  readonly currentRuntimeStreamId: string;
  readonly hasStructuredEnvelope: boolean;
  readonly hasCommittedMessage: boolean;
  readonly querySnapshot: () => Promise<{
    readonly requestId?: string;
    readonly activeTurn?: NimiRuntimeAgentSessionTurnSnapshot;
    readonly lastTurn?: NimiRuntimeAgentSessionTurnSnapshot;
  }>;
  readonly enqueue: (event: NimiRuntimeAgentConsumeEvent) => void;
  readonly logEvent: (event: NimiRuntimeAgentSnapshotRecoveryLogEvent) => void;
}): Promise<NimiRuntimeAgentSnapshotRecoveryResult> {
  let activeTurn: NimiRuntimeAgentSessionTurnSnapshot | undefined;
  let turn: NimiRuntimeAgentSessionTurnSnapshot | undefined;
  let snapshotRequestId = '';
  try {
    const snapshot = await options.querySnapshot();
    snapshotRequestId = normalizeText(snapshot.requestId);
    activeTurn = snapshot.activeTurn;
    turn = snapshot.lastTurn;
  } catch (error) {
    options.logEvent({
      level: 'warn',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-recovery-query-failed',
      details: {
        agentId: normalizeText(options.request.localAgentRef),
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId || null,
        requestId: options.requestId,
        reason: options.reason,
        error: String(error instanceof Error ? error.message : error),
      },
    });
    return 'none';
  }
  const snapshotMatchesCurrentRequest = snapshotRequestId === options.requestId;
  const activeTurnId = normalizeText(activeTurn?.turnId);
  if (!options.currentTurnAccepted && activeTurnId) {
    const streamId = normalizeText(activeTurn?.streamId)
      || (snapshotMatchesCurrentRequest ? `snapshot:${activeTurnId}` : '');
    if (!streamId) {
      return 'none';
    }
    options.logEvent({
      level: 'info',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-active-turn-bound',
      details: {
        agentId: normalizeText(options.request.localAgentRef),
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId || null,
        requestId: options.requestId,
        runtimeTurnId: activeTurnId,
        status: normalizeText(activeTurn?.status) || null,
      },
    });
    options.enqueue({
      eventName: 'runtime.agent.turn.accepted',
      localAgentRef: normalizeText(options.request.localAgentRef),
      conversationAnchorId: options.request.conversationAnchorId,
      turnId: activeTurnId,
      streamId,
      detail: { requestId: options.requestId },
    } as NimiRuntimeAgentConsumeEvent);
    return 'bound';
  }

  const turnUpdatedAtMs = Date.parse(normalizeText(turn?.updatedAt));
  const terminalAfterRequest = Number.isFinite(turnUpdatedAtMs)
    && Number.isFinite(options.requestStartedAtMs)
    && turnUpdatedAtMs >= options.requestStartedAtMs - 1000;
  if (!options.currentTurnAccepted && nimiRuntimeAgentSnapshotTurnIsTerminal(turn) && terminalAfterRequest) {
    if (!nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent(turn)) {
      return 'none';
    }
    const events = buildNimiRuntimeAgentSnapshotRecoveryEvents({
      turn,
      ownerUserId: options.request.ownerUserId,
      runtimeSourceRef: options.request.runtimeSourceRef,
      localAgentRef: options.request.localAgentRef,
      conversationAnchorId: options.request.conversationAnchorId,
      requestId: options.requestId,
      currentTurnAccepted: false,
      currentRuntimeTurnId: '',
      currentRuntimeStreamId: options.currentRuntimeStreamId,
      hasStructuredEnvelope: options.hasStructuredEnvelope,
      hasCommittedMessage: options.hasCommittedMessage,
      allowSnapshotStreamId: true,
    });
    if (events.length === 0) {
      return 'none';
    }
    options.logEvent({
      level: 'info',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-recovered',
      details: {
        agentId: normalizeText(options.request.localAgentRef),
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
    for (const event of events) options.enqueue(event);
    return 'terminal';
  }
  if (!nimiRuntimeAgentSnapshotTurnIsTerminal(turn)) {
    return 'none';
  }
  if (!options.currentTurnAccepted || normalizeText(turn.turnId) !== options.currentRuntimeTurnId) {
    return 'none';
  }
  if (!nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent(turn)) {
    return 'none';
  }
  const events = buildNimiRuntimeAgentSnapshotRecoveryEvents({
    turn,
    ownerUserId: options.request.ownerUserId,
    runtimeSourceRef: options.request.runtimeSourceRef,
    localAgentRef: options.request.localAgentRef,
    conversationAnchorId: options.request.conversationAnchorId,
    requestId: options.requestId,
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
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:snapshot-recovered',
    details: {
      agentId: normalizeText(options.request.localAgentRef),
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
        normalizeText(turn.text) || readNimiRuntimeAgentStructuredMessageField(turn.structured, 'text'),
      ),
      eventCount: events.length,
      recoveredWithoutAcceptedEvent: false,
    },
  });
  for (const event of events) options.enqueue(event);
  return 'terminal';
}
