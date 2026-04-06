// Relay session persistence — adapted from local-chat session-persist.ts
// Removed: React Dispatch/SetStateAction types, mod SDK imports
// Adapted: uses ../session-store/index.js for persistence, MainProcessChatContext setters

import type {
  ChatMessage,
  ChatMessageKind,
  LocalChatPromptTrace,
  LocalChatScheduleCancelReason,
  LocalChatSession,
  LocalChatTurn,
  LocalChatTurnAudit,
} from './types.js';
import {
  appendBeatToLocalChatTurn,
  appendTurnsToSession,
  createLocalChatTurnRecord,
  listLocalChatSessions,
  createSessionTurn,
} from '../session-store/index.js';

const MAX_SEGMENT_DELAY_MS = 8_000;

type PersistedAssistantMessageKind = Exclude<
  ChatMessageKind,
  'streaming' | 'image-pending' | 'video-pending'
>;

export type TurnDeliveryScheduleHandle = {
  turnTxnId: string;
  assistantTurnId: string;
  done: Promise<void>;
  cancel: (reason: LocalChatScheduleCancelReason) => void;
};

export type ScheduledAssistantDelivery = {
  id: string;
  delayMs: number;
  run: (input: {
    assistantTurnId: string;
    index: number;
    deliveredCount: number;
    signal: AbortSignal;
  }) => Promise<void>;
};

function normalizeSegmentDelayMs(value: number, index: number): number {
  if (index === 0) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_SEGMENT_DELAY_MS, Math.round(value));
}

function waitForDelivery(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('RELAY_CHAT_SCHEDULE_ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function refreshSessions(input: {
  targetId: string;
  viewerId: string;
  setSessions: (sessions: LocalChatSession[]) => void;
}): Promise<void> {
  input.setSessions(await listLocalChatSessions(input.targetId, input.viewerId));
}

export async function persistUserTurns(input: {
  sessionId: string;
  targetId: string;
  viewerId: string;
  userTurns: LocalChatTurn[];
  setSessions: (sessions: LocalChatSession[]) => void;
}): Promise<void> {
  if (!input.userTurns.length) {
    return;
  }
  await appendTurnsToSession(input.sessionId, input.userTurns);
  await refreshSessions({
    targetId: input.targetId,
    viewerId: input.viewerId,
    setSessions: input.setSessions,
  });
}

function buildSegmentContextText(message: ChatMessage): string {
  if (message.kind === 'image' || message.kind === 'video') {
    // Simplified media continuity summary for relay
    const parts = [
      message.meta?.mediaKind || message.kind,
      message.meta?.mediaPrompt || '',
      message.content || '',
    ].filter(Boolean);
    return parts.join(' — ');
  }
  return String(message.content || '');
}

function buildSegmentSemanticSummary(message: ChatMessage): string | null {
  if (message.kind !== 'image' && message.kind !== 'video') {
    return null;
  }
  const summary = buildSegmentContextText(message);
  return summary || null;
}

function toPersistedKind(kind: ChatMessageKind): PersistedAssistantMessageKind {
  return kind === 'voice' || kind === 'image' || kind === 'video' ? kind : 'text';
}

export async function scheduleAssistantTurnDeliveries(input: {
  sessionId: string;
  targetId: string;
  viewerId: string;
  turnTxnId: string;
  assistantTurnId: string;
  userTurns?: LocalChatTurn[];
  assistantRole?: 'assistant';
  assistantBeatCount?: number;
  deliveries: ScheduledAssistantDelivery[];
  setSessions: (sessions: LocalChatSession[]) => void;
  skipCreateAssistantTurnRecord?: boolean;
  onScheduleCancelled?: (input: {
    turnTxnId: string;
    reason: LocalChatScheduleCancelReason;
    deliveredCount: number;
    pendingCount: number;
  }) => void;
}): Promise<TurnDeliveryScheduleHandle> {
  if (input.userTurns?.length) {
    await persistUserTurns({
      sessionId: input.sessionId,
      targetId: input.targetId,
      viewerId: input.viewerId,
      userTurns: input.userTurns,
      setSessions: input.setSessions,
    });
  }

  if (!input.skipCreateAssistantTurnRecord) {
    await createLocalChatTurnRecord({
      conversationId: input.sessionId,
      role: input.assistantRole || 'assistant',
      turnTxnId: input.turnTxnId,
      turnId: input.assistantTurnId,
      beatCount: input.assistantBeatCount || input.deliveries.length,
    });
  }

  const abortController = new AbortController();
  let cancelReason: LocalChatScheduleCancelReason | null = null;
  let deliveredCount = 0;

  const cancel = (reason: LocalChatScheduleCancelReason) => {
    if (cancelReason) return;
    cancelReason = reason;
    abortController.abort();
  };

  const done = (async () => {
    for (let index = 0; index < input.deliveries.length; index += 1) {
      if (cancelReason) break;
      const delivery = input.deliveries[index];
      if (!delivery) continue;
      const delayMs = normalizeSegmentDelayMs(delivery.delayMs, index);
      try {
        await waitForDelivery(delayMs, abortController.signal);
      } catch {
        break;
      }
      if (cancelReason) break;
      console.log(
        `[relay:schedule] delivering beat ${index + 1}/${input.deliveries.length}, delayMs=${delayMs}`,
      );
      try {
        await delivery.run({
          assistantTurnId: input.assistantTurnId,
          index,
          deliveredCount,
          signal: abortController.signal,
        });
        deliveredCount += 1;
        console.log(`[relay:schedule] beat ${index + 1} delivered`);
      } catch (err) {
        console.error(`[relay:schedule] beat ${index + 1} failed, continuing`, err);
        deliveredCount += 1;
      }
    }

    console.log(
      `[relay:schedule] loop done: deliveredCount=${deliveredCount}/${input.deliveries.length}, cancelled=${Boolean(cancelReason)}`,
    );
    if (!cancelReason || !input.onScheduleCancelled) return;
    input.onScheduleCancelled({
      turnTxnId: input.turnTxnId,
      reason: cancelReason,
      deliveredCount,
      pendingCount: Math.max(0, input.deliveries.length - deliveredCount),
    });
  })();

  return {
    turnTxnId: input.turnTxnId,
    assistantTurnId: input.assistantTurnId,
    done,
    cancel,
  };
}

export async function commitAssistantMessage(input: {
  sessionId: string;
  targetId: string;
  viewerId: string;
  assistantTurnId: string;
  messageId: string;
  message: ChatMessage;
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setSessions: (sessions: LocalChatSession[]) => void;
  promptTrace?: LocalChatPromptTrace | null;
  turnAudit?: LocalChatTurnAudit | null;
}): Promise<void> {
  const kind = input.message.kind;
  if (kind === 'streaming' || kind === 'image-pending' || kind === 'video-pending') {
    return;
  }
  input.setMessages((prev) => {
    let replaced = false;
    const next = prev.map((item) => {
      if (item.id !== input.messageId) {
        return item;
      }
      replaced = true;
      return input.message;
    });
    return replaced ? next : [...prev, input.message];
  });
  await appendBeatToLocalChatTurn({
    conversationId: input.sessionId,
    turnId: input.assistantTurnId,
    role: 'assistant',
    kind: toPersistedKind(input.message.kind),
    content: input.message.content,
    contextText: buildSegmentContextText(input.message),
    semanticSummary: buildSegmentSemanticSummary(input.message),
    mediaSpec: input.message.meta?.mediaSpec,
    mediaShadow: input.message.meta?.mediaShadow,
    media: input.message.media,
    timestamp: input.message.timestamp.toISOString(),
    latencyMs: input.message.latencyMs,
    meta: input.message.meta,
    promptTrace: input.promptTrace || null,
    audit: input.turnAudit || null,
    deliveryStatus:
      input.message.meta?.mediaStatus === 'pending'
        ? 'pending'
        : input.message.meta?.mediaStatus === 'failed'
          ? 'failed'
          : input.message.meta?.mediaStatus === 'blocked'
            ? 'blocked'
            : 'ready',
    beatId: input.message.id,
    beatIndex: Number.isFinite(input.message.meta?.beatIndex)
      ? Math.max(0, Number(input.message.meta?.beatIndex))
      : 0,
    beatCount:
      Number.isFinite(input.message.meta?.beatCount) && Number(input.message.meta?.beatCount) > 0
        ? Math.floor(Number(input.message.meta?.beatCount))
        : 1,
  });
  // Skip refreshSessions here — it causes contextKey to bounce mid-delivery,
  // cancelling subsequent beats. Session list is refreshed after full turn.
}

export { createSessionTurn };
