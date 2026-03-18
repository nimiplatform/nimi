// Relay send-flow helpers — adapted from local-chat send-flow-helpers.ts
// Removed: window/RAF references, mod SDK imports
// Adapted: waitForNextPaint → Node.js setTimeout(0), types from local ./types.js

import type {
  ChatMessage,
  LocalChatBeatModality,
  LocalChatTurnMode,
  RelayChatTurnSendInput,
  VoiceConversationMode,
  MediaExecutionDecision,
  LocalChatScheduleCancelReason,
} from './types.js';
import { orchestrateBeatModalities } from './modality-orchestrator.js';
import { resolveTurnMode } from './turn-mode-resolver.js';
import { createUlid } from './ulid.js';
import { stripTrailingEndMarkerFragment } from './stream-end-marker.js';
import type { MainProcessChatContext } from './main-process-context.js';

export type OrchestratedBeat = ReturnType<typeof orchestrateBeatModalities>[number];

export type ConcreteMediaDecision = Exclude<MediaExecutionDecision, { kind: 'none' }>;

export type PreparedAssistantDelivery = {
  id: string;
  kind: LocalChatBeatModality;
  content: string;
  delayMs: number;
  meta: ChatMessage['meta'];
  beat: OrchestratedBeat;
};

export function createTurnTxnId(): string {
  return `txn_${createUlid()}`;
}

export function createTurnId(): string {
  return `turn_${createUlid()}`;
}

/**
 * Node.js equivalent of waitForNextPaint — yields the event loop once
 * so IPC messages dispatched before this point can flush to the renderer.
 */
export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createCancelledAudit(input: {
  reason: LocalChatScheduleCancelReason;
  targetId: string;
  worldId: string | null;
  latencyMs: number;
}) {
  return {
    id: `audit_${createUlid()}`,
    targetId: input.targetId,
    worldId: input.worldId,
    latencyMs: input.latencyMs,
    error: input.reason,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeBeatText(content: string): string {
  return stripTrailingEndMarkerFragment(String(content || '').replace(/\s+/g, ' ').trim());
}

export function toMarkerOverrideIntent(input: {
  beat: OrchestratedBeat;
  turnTxnId: string;
}) {
  if (
    (input.beat.modality !== 'image' && input.beat.modality !== 'video')
    || !input.beat.assetRequest
  ) {
    return null;
  }
  return {
    type: input.beat.assetRequest.kind,
    prompt: input.beat.assetRequest.prompt,
    source: 'tag' as const,
    plannerTrigger: 'marker-override' as const,
    pendingMessageId: input.beat.beatId,
    plannerConfidence: input.beat.assetRequest.confidence,
    plannerSuggestsNsfw: input.beat.assetRequest.nsfwIntent === 'suggested',
  };
}

export function bindMediaDecisionToDelivery(
  decision: ConcreteMediaDecision,
  deliveryId: string,
): ConcreteMediaDecision {
  return {
    ...decision,
    intent: {
      ...decision.intent,
      pendingMessageId: deliveryId,
    },
    prepared: {
      ...decision.prepared,
      pendingMessageId: deliveryId,
    },
  };
}

export function createStandaloneMediaDelivery(input: {
  decision: ConcreteMediaDecision;
  turnId: string;
  turnMode: ReturnType<typeof resolveTurnMode>;
  planId: string;
  voiceConversationMode: VoiceConversationMode;
  beatIndex: number;
}): PreparedAssistantDelivery {
  const beatId = input.decision.intent.pendingMessageId;
  const beat: OrchestratedBeat = {
    beatId,
    turnId: input.turnId,
    beatIndex: input.beatIndex,
    beatCount: input.beatIndex + 1,
    intent: 'media',
    relationMove: input.turnMode,
    sceneMove: 'media',
    modality: input.decision.intent.type,
    text: '',
    pauseMs: 420,
    cancellationScope: 'tail',
    assetRequest: {
      kind: input.decision.intent.type,
      prompt: input.decision.intent.prompt,
      confidence: input.decision.intent.plannerConfidence ?? 0.65,
      nsfwIntent: input.decision.intent.plannerSuggestsNsfw ? 'suggested' : 'none',
    },
  };
  return {
    id: beatId,
    kind: input.decision.intent.type,
    content: '',
    delayMs: beat.pauseMs,
    beat,
    meta: {
      interactionPlanId: input.planId,
      planId: input.planId,
      turnId: input.turnId,
      beatId,
      beatIndex: beat.beatIndex,
      beatCount: beat.beatCount,
      beatModality: input.decision.intent.type,
      pauseMs: beat.pauseMs,
      relationMove: beat.relationMove,
      sceneMove: beat.sceneMove,
      turnMode: input.turnMode,
      voiceConversationMode: input.voiceConversationMode,
      segmentId: beatId,
      segmentIndex: beat.beatIndex + 1,
      segmentCount: beat.beatCount,
      intent: beat.intent,
      mediaType: input.decision.intent.type,
      mediaPrompt: input.decision.intent.prompt,
      mediaPlannerTrigger: input.decision.intent.plannerTrigger,
      mediaPlannerConfidence: input.decision.intent.plannerConfidence,
      mediaIntentSource: input.decision.intent.source,
    },
  };
}

export function buildAssistantDeliveries(input: {
  beats: OrchestratedBeat[];
  planId: string;
  turnMode: ReturnType<typeof resolveTurnMode>;
  voiceConversationMode: VoiceConversationMode;
}): PreparedAssistantDelivery[] {
  return input.beats
    .map((beat) => ({
      id: beat.beatId,
      kind: beat.modality,
      content: normalizeBeatText(beat.text),
      delayMs: beat.beatIndex === 0 ? 0 : beat.pauseMs,
      beat,
      meta: {
        interactionPlanId: input.planId,
        planId: input.planId,
        turnId: beat.turnId,
        beatId: beat.beatId,
        beatIndex: beat.beatIndex,
        beatCount: beat.beatCount,
        beatModality: beat.modality,
        pauseMs: beat.pauseMs,
        relationMove: beat.relationMove,
        sceneMove: beat.sceneMove,
        turnMode: input.turnMode,
        voiceConversationMode: input.voiceConversationMode,
        autoPlayVoice: beat.modality === 'voice' ? Boolean(beat.autoPlayVoice) : false,
        segmentId: beat.beatId,
        segmentIndex: beat.beatIndex + 1,
        segmentCount: beat.beatCount,
        ...(beat.modality === 'voice' || beat.modality === 'text'
          ? { channelDecision: beat.modality }
          : {}),
        intent: beat.intent,
        ...(beat.assetRequest
          ? {
              mediaType: beat.assetRequest.kind,
              mediaPrompt: beat.assetRequest.prompt,
              mediaPlannerTrigger: 'marker-override' as const,
              mediaPlannerConfidence: beat.assetRequest.confidence,
            }
          : {}),
      },
    }))
    .filter(
      (delivery) =>
        Boolean(delivery.content) || delivery.kind === 'image' || delivery.kind === 'video',
    );
}

export function resolveFirstBeatIntent(
  turnMode: ReturnType<typeof resolveTurnMode>,
): OrchestratedBeat['intent'] {
  if (turnMode === 'emotional') return 'comfort';
  if (turnMode === 'checkin') return 'checkin';
  if (turnMode === 'playful') return 'tease';
  if (turnMode === 'intimate') return 'invite';
  if (turnMode === 'explicit-media') return 'media';
  return 'answer';
}

export function ensureNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new Error('RELAY_CHAT_TURN_SEND_ABORTED');
}

export function isAbortedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message === 'RELAY_CHAT_TURN_SEND_ABORTED'
    || message === 'RELAY_CHAT_SCHEDULE_ABORTED'
    || message === 'LOCAL_CHAT_TURN_SEND_ABORTED'
    || message === 'LOCAL_CHAT_SCHEDULE_ABORTED'
    || message === 'AbortError'
  );
}

export function upsertTransientFirstBeatMessage(input: {
  chatContext: MainProcessChatContext;
  messageId: string;
  content: string;
  turnId: string;
  turnMode: ReturnType<typeof resolveTurnMode>;
  voiceConversationMode: VoiceConversationMode;
}) {
  const content = normalizeBeatText(input.content);
  if (!content) return;
  const streamingMessage: ChatMessage = {
    id: input.messageId,
    role: 'assistant',
    kind: 'streaming',
    content,
    timestamp: new Date(),
    meta: {
      turnId: input.turnId,
      beatId: input.messageId,
      beatIndex: 0,
      beatCount: 1,
      beatModality: 'text',
      pauseMs: 0,
      turnMode: input.turnMode,
      voiceConversationMode: input.voiceConversationMode,
      channelDecision: 'text',
      intent: resolveFirstBeatIntent(input.turnMode),
      segmentId: input.messageId,
      segmentIndex: 1,
      segmentCount: 1,
    },
  };
  input.chatContext.setMessages((prev) => {
    let replaced = false;
    const next = prev.map((message) => {
      if (message.id !== input.messageId) return message;
      replaced = true;
      return streamingMessage;
    });
    return replaced ? next : [...prev, streamingMessage];
  });
}
