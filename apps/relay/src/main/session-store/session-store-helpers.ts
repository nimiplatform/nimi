import type {
  ChatMessage,
  ChatMessageMeta,
  LocalChatConversationRecord,
  LocalChatMediaArtifactShadow,
  LocalChatMediaAssetRecord,
  LocalChatMediaGenerationSpec,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatStoredBeat,
  LocalChatTurn,
  LocalChatTurnAudit,
  LocalChatTurnRecord,
  LocalChatTurnWithBeats,
} from '../chat-pipeline/types.js';
import { createUlid } from '../chat-pipeline/ulid.js';
import {
  asIsoString,
  cloneStoredBeat,
  cloneTurnRecord,
  nowIso,
  trimString,
} from './normalizers.js';
import { getLedgerCache } from './ledger-db.js';

export type CreateConversationInput = {
  targetId: string;
  viewerId: string;
  worldId?: string | null;
  title?: string;
};

export type TurnRecordInsertInput = {
  conversationId: string;
  role: 'user' | 'assistant';
  turnTxnId?: string | null;
  turnId?: string;
  seq?: number;
  createdAt?: string;
  beatCount?: number;
};

export type BeatInsertInput = {
  conversationId: string;
  turnId: string;
  role: 'user' | 'assistant';
  kind: LocalChatStoredBeat['kind'];
  content: string;
  contextText: string;
  semanticSummary?: string | null;
  media?: LocalChatStoredBeat['media'];
  timestamp?: string;
  latencyMs?: number;
  meta?: ChatMessageMeta;
  promptTrace?: LocalChatPromptTrace | null;
  audit?: LocalChatTurnAudit | null;
  deliveryStatus?: LocalChatStoredBeat['deliveryStatus'];
  beatId?: string;
  beatIndex?: number;
  beatCount?: number;
  mediaSpec?: LocalChatMediaGenerationSpec;
  mediaShadow?: LocalChatMediaArtifactShadow;
};

export const EXACT_HISTORY_TURN_LIMIT = 8;

export function matchesViewerId(recordViewerId: string, viewerId?: string): boolean {
  const normalizedViewerId = trimString(viewerId);
  if (!normalizedViewerId) return true;
  return trimString(recordViewerId) === normalizedViewerId;
}

export function compareIsoTimestamp(left: string | null | undefined, right: string | null | undefined): number {
  const leftMs = Date.parse(String(left || ''));
  const rightMs = Date.parse(String(right || ''));
  const normalizedLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const normalizedRight = Number.isFinite(rightMs) ? rightMs : 0;
  return normalizedLeft - normalizedRight;
}

function buildConversationScopeKey(targetId: string, viewerId: string): string {
  return `${trimString(viewerId)}::${trimString(targetId)}`;
}

function sortConversationRecords(records: LocalChatConversationRecord[]): LocalChatConversationRecord[] {
  return [...records].sort((left, right) => (
    compareIsoTimestamp(right.updatedAt, left.updatedAt)
    || compareIsoTimestamp(right.createdAt, left.createdAt)
    || left.id.localeCompare(right.id)
  ));
}

function sortTurnRecords(records: LocalChatTurnRecord[]): LocalChatTurnRecord[] {
  return [...records].sort((left, right) => (
    left.seq - right.seq
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
}

function sortStoredBeats(records: LocalChatStoredBeat[]): LocalChatStoredBeat[] {
  return [...records].sort((left, right) => (
    left.turnSeq - right.turnSeq
    || left.beatIndex - right.beatIndex
    || left.timestamp.localeCompare(right.timestamp)
    || left.id.localeCompare(right.id)
  ));
}

export function turnsForConversation(conversationId: string): LocalChatTurnRecord[] {
  return sortTurnRecords(
    [...getLedgerCache().turnsById.values()].filter((turn) => turn.conversationId === conversationId),
  );
}

export function findConversationForScope(input: {
  targetId: string;
  viewerId: string;
}): LocalChatConversationRecord | null {
  const scopeKey = buildConversationScopeKey(input.targetId, input.viewerId);
  return sortConversationRecords(
    [...getLedgerCache().conversationsById.values()].filter((conversation) => (
      buildConversationScopeKey(conversation.targetId, conversation.viewerId) === scopeKey
    )),
  )[0] || null;
}

export function beatsForTurn(turnId: string): LocalChatStoredBeat[] {
  return sortStoredBeats(
    [...getLedgerCache().beatsById.values()].filter((beat) => beat.turnId === turnId),
  );
}

export function mediaAssetsForConversation(conversationId: string): LocalChatMediaAssetRecord[] {
  return [...getLedgerCache().mediaAssetsById.values()]
    .filter((asset) => asset.conversationId === conversationId)
    .sort((left, right) => (
      compareIsoTimestamp(right.lastHitAt, left.lastHitAt)
      || compareIsoTimestamp(right.createdAt, left.createdAt)
      || left.id.localeCompare(right.id)
    ));
}

export function buildTurnWithBeats(turn: LocalChatTurnRecord): LocalChatTurnWithBeats {
  const beats = beatsForTurn(turn.id);
  return {
    ...cloneTurnRecord(turn),
    beats: beats.map((beat) => cloneStoredBeat(beat)),
  };
}

export function projectBeatToTurn(turn: LocalChatTurnRecord, beat: LocalChatStoredBeat): LocalChatTurn {
  return {
    id: beat.id,
    turnId: turn.id,
    turnSeq: turn.seq,
    beatIndex: beat.beatIndex,
    beatCount: Math.max(turn.beatCount, beat.beatCount, beat.beatIndex + 1),
    role: beat.role,
    kind: beat.kind,
    content: beat.content,
    contextText: beat.contextText,
    semanticSummary: beat.semanticSummary,
    mediaSpec: beat.mediaSpec,
    mediaShadow: beat.mediaShadow,
    media: beat.media,
    timestamp: beat.timestamp,
    latencyMs: beat.latencyMs,
    meta: beat.meta,
    promptTrace: beat.promptTrace,
    audit: beat.audit,
  };
}

export function projectConversationToSession(record: LocalChatConversationRecord): LocalChatSession {
  const groupedTurns = turnsForConversation(record.id)
    .map((turn) => buildTurnWithBeats(turn))
    .filter((turn) => turn.beats.length > 0);
  const turns = groupedTurns.flatMap((turn) => (
    turn.beats.map((beat) => projectBeatToTurn(turn, beat))
  ));
  return {
    id: record.id,
    targetId: record.targetId,
    viewerId: record.viewerId,
    worldId: record.worldId,
    title: record.title,
    turns,
    turnCount: groupedTurns.length,
    messageCount: turns.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function latestTraceFromSession(session: LocalChatSession | null): LocalChatPromptTrace | null {
  if (!session) return null;
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    const turn = session.turns[index];
    if (!turn || turn.role !== 'assistant') continue;
    if (turn.promptTrace) return turn.promptTrace;
  }
  return null;
}

export function latestAuditFromSession(session: LocalChatSession | null): LocalChatTurnAudit | null {
  if (!session) return null;
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    const turn = session.turns[index];
    if (!turn || turn.role !== 'assistant') continue;
    if (turn.audit) return turn.audit;
  }
  return null;
}

export function createProjectionTurnFromMessage(
  message: ChatMessage,
  promptTrace?: LocalChatPromptTrace | null,
  audit?: LocalChatTurnAudit | null,
): LocalChatTurn {
  const metaTurnId = trimString(message.meta?.turnId);
  const beatIndex = Number.isFinite(message.meta?.beatIndex) ? Math.max(0, Number(message.meta?.beatIndex)) : 0;
  const beatCount = Number.isFinite(message.meta?.beatCount) && Number(message.meta?.beatCount) > 0
    ? Math.floor(Number(message.meta?.beatCount))
    : 1;
  return {
    id: message.id,
    turnId: metaTurnId || message.id,
    turnSeq: 0,
    beatIndex,
    beatCount,
    role: message.role,
    kind: message.kind === 'voice' || message.kind === 'image' || message.kind === 'video'
      ? message.kind
      : 'text',
    content: message.content,
    contextText: message.content,
    semanticSummary: null,
    mediaSpec: message.meta?.mediaSpec,
    mediaShadow: message.meta?.mediaShadow,
    media: message.media,
    timestamp: message.timestamp.toISOString(),
    latencyMs: message.latencyMs,
    meta: message.meta,
    promptTrace: promptTrace || undefined,
    audit: audit || undefined,
  };
}

export function buildProjectionSession(session: LocalChatSession): LocalChatSession {
  return {
    ...session,
    turns: [...session.turns],
  };
}

export function buildConversationRecord(input: CreateConversationInput): LocalChatConversationRecord {
  const createdAt = nowIso();
  return {
    id: `conv_${createUlid()}`,
    targetId: trimString(input.targetId),
    viewerId: trimString(input.viewerId) || 'viewer',
    worldId: trimString(input.worldId) || null,
    title: trimString(input.title) || 'Session',
    createdAt,
    updatedAt: createdAt,
    lastTurnSeq: 0,
  };
}

export function buildTurnRecord(input: TurnRecordInsertInput, lastTurnSeq: number): LocalChatTurnRecord {
  const seq = Number.isFinite(input.seq) ? Number(input.seq) : lastTurnSeq + 1;
  const createdAt = asIsoString(input.createdAt, nowIso());
  return {
    id: trimString(input.turnId) || `turn_${createUlid()}`,
    conversationId: trimString(input.conversationId),
    seq,
    role: input.role,
    turnTxnId: trimString(input.turnTxnId) || null,
    createdAt,
    updatedAt: createdAt,
    beatCount: Number.isFinite(input.beatCount) && Number(input.beatCount) > 0
      ? Math.floor(Number(input.beatCount))
      : 1,
  };
}
