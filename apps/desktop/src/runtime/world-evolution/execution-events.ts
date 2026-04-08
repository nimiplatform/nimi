import type {
  WorldEvolutionActorRef,
  WorldEvolutionEffectClass,
  WorldEvolutionEvidenceRef,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionExecutionEventView,
  WorldEvolutionExecutionStage,
} from '@nimiplatform/sdk/runtime';

import { createSecureIdSuffix } from '../id.js';

const DESKTOP_WEE_APP_ID = 'nimi.desktop';
const MAX_EVENTS = 2000;

const executionEvents: WorldEvolutionExecutionEventView[] = [];

type LocalTurnExecutionEventInput = {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  worldId?: string;
  agentId?: string;
  provider: string;
  mode: string;
  traceId?: string;
  eventKind: string;
  stage: WorldEvolutionExecutionStage;
  effectClass: WorldEvolutionEffectClass;
  reason: string;
  timestamp?: string;
  detail: {
    kind: string;
    [key: string]: unknown;
  };
  evidenceRefs?: WorldEvolutionEvidenceRef[];
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function createEventId(): string {
  return `wee:evt:${Date.now().toString(36)}:${createSecureIdSuffix()}`;
}

function normalizeTimestamp(value?: string): string {
  const normalized = normalizeText(value);
  return normalized || new Date().toISOString();
}

function buildActorRefs(agentId?: string): WorldEvolutionActorRef[] {
  const runtimeActor: WorldEvolutionActorRef = {
    actorId: 'core.kernel',
    actorType: 'RUNTIME',
    role: 'executor',
  };
  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) {
    return [runtimeActor];
  }
  return [
    runtimeActor,
    {
      actorId: normalizedAgentId,
      actorType: 'AGENT',
      role: 'subject',
    },
  ];
}

function buildEvidenceRefs(
  requestId: string,
  traceId: string,
  evidenceRefs?: WorldEvolutionEvidenceRef[],
): WorldEvolutionEvidenceRef[] {
  const normalizedRefs = Array.isArray(evidenceRefs)
    ? evidenceRefs.filter((item) => normalizeText(item.kind) && normalizeText(item.refId))
    : [];
  const result: WorldEvolutionEvidenceRef[] = [
    {
      kind: 'request',
      refId: requestId,
    },
    {
      kind: 'trace',
      refId: traceId,
    },
  ];
  for (const item of normalizedRefs) {
    if (result.some((existing) => existing.kind === item.kind && existing.refId === item.refId)) {
      continue;
    }
    result.push(item);
  }
  return result;
}

function maybeBuildLocalTurnExecutionEvent(input: LocalTurnExecutionEventInput): WorldEvolutionExecutionEventView | null {
  const requestId = normalizeText(input.requestId);
  const worldId = normalizeText(input.worldId);
  const sessionId = normalizeText(input.sessionId);
  const traceId = normalizeText(input.traceId);
  const provider = normalizeText(input.provider);
  const mode = normalizeText(input.mode);
  const eventKind = normalizeText(input.eventKind);
  const reason = normalizeText(input.reason);
  const detailKind = normalizeText(input.detail?.kind);

  if (
    !requestId
    || !worldId
    || !sessionId
    || !traceId
    || !provider
    || !mode
    || !eventKind
    || !reason
    || !detailKind
    || !Number.isInteger(input.turnIndex)
    || input.turnIndex < 0
  ) {
    return null;
  }

  return {
    eventId: createEventId(),
    worldId,
    appId: DESKTOP_WEE_APP_ID,
    sessionId,
    traceId,
    tick: input.turnIndex,
    timestamp: normalizeTimestamp(input.timestamp),
    eventKind,
    stage: input.stage,
    actorRefs: buildActorRefs(input.agentId),
    causation: null,
    correlation: requestId,
    effectClass: input.effectClass,
    reason,
    evidenceRefs: buildEvidenceRefs(requestId, traceId, input.evidenceRefs),
    detail: {
      ...input.detail,
      kind: detailKind,
      provider,
      mode,
    },
  };
}

function appendExecutionEvent(event: WorldEvolutionExecutionEventView): void {
  executionEvents.push(event);
  if (executionEvents.length > MAX_EVENTS) {
    executionEvents.splice(0, executionEvents.length - MAX_EVENTS);
  }
}

function matchesActorRef(
  expected: WorldEvolutionActorRef,
  actual: WorldEvolutionActorRef,
): boolean {
  return expected.actorId === actual.actorId
    && expected.actorType === actual.actorType
    && (expected.role === undefined || expected.role === actual.role);
}

function matchesEvidenceRef(
  expected: WorldEvolutionEvidenceRef,
  actual: WorldEvolutionEvidenceRef,
): boolean {
  if (expected.kind !== actual.kind || expected.refId !== actual.refId) {
    return false;
  }
  return expected.uri === undefined || expected.uri === actual.uri;
}

function matchesExecutionEventFilter(
  event: WorldEvolutionExecutionEventView,
  selector: WorldEvolutionExecutionEventSelector,
): boolean {
  if (selector.worldId && event.worldId !== selector.worldId) return false;
  if (selector.appId && event.appId !== selector.appId) return false;
  if (selector.sessionId && event.sessionId !== selector.sessionId) return false;
  if (selector.traceId && event.traceId !== selector.traceId) return false;
  if (selector.eventKind && event.eventKind !== selector.eventKind) return false;
  if (selector.stage && event.stage !== selector.stage) return false;
  if (selector.causation !== undefined && event.causation !== selector.causation) return false;
  if (selector.correlation !== undefined && event.correlation !== selector.correlation) return false;
  if (selector.effectClass && event.effectClass !== selector.effectClass) return false;
  if (selector.reason && event.reason !== selector.reason) return false;
  if (selector.actorRefs && !selector.actorRefs.every((expected) => event.actorRefs.some((actual) => matchesActorRef(expected, actual)))) {
    return false;
  }
  if (selector.evidenceRefs && !selector.evidenceRefs.every((expected) => event.evidenceRefs.some((actual) => matchesEvidenceRef(expected, actual)))) {
    return false;
  }
  return true;
}

export function recordDesktopWorldEvolutionLocalTurnExecutionEvent(
  input: LocalTurnExecutionEventInput,
): WorldEvolutionExecutionEventView | null {
  const event = maybeBuildLocalTurnExecutionEvent(input);
  if (!event) {
    return null;
  }
  appendExecutionEvent(event);
  return event;
}

export function queryDesktopWorldEvolutionExecutionEvents(
  selector: WorldEvolutionExecutionEventSelector,
): WorldEvolutionExecutionEventView[] {
  if (selector.eventId) {
    return executionEvents.filter((event) => event.eventId === selector.eventId);
  }
  if (
    selector.worldId
    && selector.sessionId
    && selector.tick !== undefined
    && Object.keys(selector).length === 3
  ) {
    return executionEvents.filter((event) => (
      event.worldId === selector.worldId
      && event.sessionId === selector.sessionId
      && event.tick === selector.tick
    ));
  }
  return executionEvents.filter((event) => matchesExecutionEventFilter(event, selector));
}

export function clearDesktopWorldEvolutionExecutionEventsForTest(): void {
  executionEvents.splice(0, executionEvents.length);
}
