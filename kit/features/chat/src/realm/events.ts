import type { RealmMessageViewDto } from './codec.js';
import type { RealmChatEventEnvelope, RealmChatEventEnvelopeDto, RealmChatSessionReadyPayload, RealmChatSessionState, RealmChatSessionSyncRequiredPayload } from './types.js';
import { asRecord, normalizeString } from './shared.js';
import { normalizeRealmRealtimeMessagePayload } from './messages.js';

export function rememberRealmChatSeenEvent(
  seen: Map<string, number>,
  key: string,
  limit = 3000,
): boolean {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return false;
  }
  if (seen.has(normalizedKey)) {
    seen.delete(normalizedKey);
    seen.set(normalizedKey, Date.now());
    return true;
  }
  seen.set(normalizedKey, Date.now());
  if (seen.size > limit) {
    const { done, value } = seen.keys().next();
    if (!done && value !== undefined) {
      seen.delete(value);
    }
  }
  return false;
}

export function normalizeRealmChatEventEnvelope(
  payload: RealmChatEventEnvelopeDto,
): RealmChatEventEnvelope | null {
  const eventId = normalizeString(payload.eventId);
  const chatId = normalizeString(payload.chatId);
  const kind = normalizeString(payload.kind);
  const seqRaw = Number(payload.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  return {
    ...payload,
    sessionId: normalizeString(payload.sessionId),
    eventId,
    chatId,
    kind,
    seq,
  };
}

export function parseRealmSocketChatEvent(payload: unknown): RealmChatEventEnvelope | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const eventId = normalizeString(record.eventId);
  const chatId = normalizeString(record.chatId);
  const kind = normalizeString(record.kind);
  const seqRaw = Number(record.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  const eventPayload = asRecord(record.payload) ?? {};
  return {
    actorId: normalizeString(record.actorId),
    seq,
    eventId,
    chatId,
    kind,
    occurredAt: normalizeString(record.occurredAt),
    payload: eventPayload as RealmChatEventEnvelopeDto['payload'],
    sessionId: normalizeString(record.sessionId),
  };
}

export function parseRealmChatSessionReadyPayload(
  payload: unknown,
): RealmChatSessionReadyPayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const chatId = normalizeString(record.chatId);
  const sessionId = normalizeString(record.sessionId);
  const resumeToken = normalizeString(record.resumeToken);
  const lastAckSeqRaw = Number(record.lastAckSeq);
  const lastAckSeq = Number.isFinite(lastAckSeqRaw) ? Math.max(0, Math.floor(lastAckSeqRaw)) : 0;
  if (!chatId || !sessionId || !resumeToken) {
    return null;
  }
  return {
    chatId,
    sessionId,
    resumeToken,
    lastAckSeq,
  };
}

export function parseRealmChatSyncRequiredPayload(
  payload: unknown,
): RealmChatSessionSyncRequiredPayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const chatId = normalizeString(record.chatId);
  if (!chatId) {
    return null;
  }
  const requestedAfterSeqRaw = Number(record.requestedAfterSeq);
  return {
    chatId,
    requestedAfterSeq: Number.isFinite(requestedAfterSeqRaw)
      ? Math.max(0, Math.floor(requestedAfterSeqRaw))
      : 0,
  };
}

export function getRealmReplayMaxSeq(
  events: readonly RealmChatEventEnvelopeDto[],
  fallbackSeq: number,
): number {
  return events.reduce((maxSeq, candidate) => {
    const normalized = normalizeRealmChatEventEnvelope(candidate);
    if (!normalized) {
      return maxSeq;
    }
    return Math.max(maxSeq, normalized.seq);
  }, fallbackSeq);
}

export function createRealmChatSessionState(
  payload: RealmChatSessionReadyPayload,
): RealmChatSessionState {
  return {
    chatId: payload.chatId,
    sessionId: payload.sessionId,
    resumeToken: payload.resumeToken,
    lastAckSeq: payload.lastAckSeq,
  };
}

export function createRealmChatSessionOpenPayload(
  chatId: string | null,
  session: RealmChatSessionState | null,
): { chatId: string; resumeToken?: string; lastAckSeq: number } | null {
  const normalizedChatId = normalizeString(chatId);
  if (!normalizedChatId) {
    return null;
  }
  return {
    chatId: normalizedChatId,
    resumeToken: session?.chatId === normalizedChatId ? session.resumeToken : undefined,
    lastAckSeq: session?.chatId === normalizedChatId ? session.lastAckSeq : 0,
  };
}

export function advanceRealmChatSessionAck(
  session: RealmChatSessionState | null,
  event: RealmChatEventEnvelope,
): {
  nextSession: RealmChatSessionState;
  ackPayload: { chatId: string; sessionId: string; ackSeq: number };
} | null {
  if (!session || session.chatId !== event.chatId || event.seq <= session.lastAckSeq) {
    return null;
  }
  return {
    nextSession: {
      ...session,
      lastAckSeq: event.seq,
    },
    ackPayload: {
      chatId: session.chatId,
      sessionId: session.sessionId,
      ackSeq: event.seq,
    },
  };
}

export function resolveRealmChatSyncRequest(input: {
  payload: RealmChatSessionSyncRequiredPayload | null;
  selectedChatId: string | null;
  session: RealmChatSessionState | null;
}): { chatId: string; requestedAfterSeq: number } | null {
  const chatId = normalizeString(input.payload?.chatId || '');
  if (!chatId || chatId !== normalizeString(input.selectedChatId || '')) {
    return null;
  }
  return {
    chatId,
    requestedAfterSeq: input.payload && input.payload.requestedAfterSeq > 0
      ? input.payload.requestedAfterSeq
      : Math.max(0, Math.floor(input.session?.lastAckSeq || 0)),
  };
}

export function extractRealmMessageFromEvent(
  event: RealmChatEventEnvelope,
): RealmMessageViewDto | null {
  const payload = asRecord(event.payload);
  const candidate = payload ? asRecord(payload.message) : null;
  return candidate ? normalizeRealmRealtimeMessagePayload(candidate) : null;
}
