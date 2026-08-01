import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type {
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTranscriptMessage,
  NimiRuntimeAgentSessionTurnSnapshot,
} from '@nimiplatform/sdk/runtime';

import type { ZhiyuCanonicalRendererBindings } from '../renderer/contract.js';
import { hydrateZhiyuAgentChatFromRuntimeSessionSnapshot } from '../shell/agent-chat/agent-conversation-state.js';
import { resolveZhiyuChatAttachmentMedia } from '../shell/agent-chat/turn-attachments.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';

type HydrationInput = Parameters<
  ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']
>[0];

type ConversationSnapshotPort = Pick<NimiLocalAppClient['conversation'], 'snapshot'>;
type ArtifactReadPort = Pick<NimiLocalAppClient['artifacts'], 'readArtifactBytes'>;

export async function hydrateZhiyuProductionConversation(
  input: HydrationInput,
  conversation: ConversationSnapshotPort,
  artifacts?: ArtifactReadPort,
): Promise<Pick<ZhiyuEvidence, 'source' | 'chat'>> {
  try {
    const snapshot = await conversation.snapshot({
      agentHandle: input.agentHandle as Parameters<ConversationSnapshotPort['snapshot']>[0]['agentHandle'],
      conversationAnchorId: input.conversationAnchorId,
    });
    const normalized = normalizeRuntimeSessionSnapshot(snapshot);
    const resolved = artifacts
      ? await resolveTranscriptImageMediaUrls(normalized, artifacts)
      : normalized;
    return {
      source: input.currentSource,
      chat: hydrateZhiyuAgentChatFromRuntimeSessionSnapshot({
        current: input.currentChat,
        agentHandle: input.agentHandle,
        conversationAnchorId: input.conversationAnchorId,
        snapshot: resolved,
      }),
    };
  } catch (error) {
    return {
      source: input.currentSource,
      chat: hydrationFailure(input, error),
    };
  }
}

async function resolveTranscriptImageMediaUrls(
  snapshot: NimiRuntimeAgentSessionSnapshot,
  artifacts: ArtifactReadPort,
): Promise<NimiRuntimeAgentSessionSnapshot> {
  const transcript = Array.isArray(snapshot.transcript) ? snapshot.transcript : null;
  if (!transcript || !transcript.some((message) => (
    message.kind === 'image' && text(message.artifactId) && !text(message.mediaUrl)
  ))) {
    return snapshot;
  }
  const resolvedTranscript = await Promise.all(transcript.map(async (message) => {
    const artifactId = text(message.artifactId);
    if (message.kind !== 'image' || !artifactId || text(message.mediaUrl)) {
      return message;
    }
    const media = await resolveZhiyuChatAttachmentMedia(
      artifactId,
      text(message.mediaMimeType),
      (readInput) => artifacts.readArtifactBytes(readInput),
    );
    if (!media) {
      console.warn('zhiyu:snapshot-image-media-resolve-failed', { artifactId });
      return message;
    }
    return { ...message, mediaUrl: media.mediaUrl, mediaMimeType: media.mediaMimeType };
  }));
  return { ...snapshot, transcript: resolvedTranscript };
}

function normalizeRuntimeSessionSnapshot(value: Readonly<Record<string, unknown>>): NimiRuntimeAgentSessionSnapshot {
  const transcript = Array.isArray(value.transcript)
    ? value.transcript.map(normalizeTranscriptMessage)
    : undefined;
  return {
    requestId: text(value.requestId ?? value.request_id) || undefined,
    threadId: text(value.threadId ?? value.thread_id) || undefined,
    subjectUserId: text(value.subjectUserId ?? value.subject_user_id) || undefined,
    sessionStatus: text(value.sessionStatus ?? value.session_status) || undefined,
    transcriptMessageCount: integer(value.transcriptMessageCount ?? value.transcript_message_count),
    transcript,
    activeTurn: normalizeTurnSnapshot(value.activeTurn ?? value.active_turn),
    lastTurn: normalizeTurnSnapshot(value.lastTurn ?? value.last_turn),
  };
}

function normalizeTranscriptMessage(value: unknown): NimiRuntimeAgentSessionTranscriptMessage {
  const record = isRecord(value) ? value : {};
  return {
    id: text(record.id),
    role: text(record.role) as NimiRuntimeAgentSessionTranscriptMessage['role'],
    content: text(record.content),
    status: text(record.status) as NimiRuntimeAgentSessionTranscriptMessage['status'],
    kind: text(record.kind) as NimiRuntimeAgentSessionTranscriptMessage['kind'],
    createdAt: text(record.createdAt ?? record.created_at),
    updatedAt: text(record.updatedAt ?? record.updated_at),
    parentMessageId: text(record.parentMessageId ?? record.parent_message_id) || undefined,
    traceId: text(record.traceId ?? record.trace_id) || undefined,
    reasoningText: text(record.reasoningText ?? record.reasoning_text) || undefined,
    mediaUrl: text(record.mediaUrl ?? record.media_url) || undefined,
    mediaMimeType: text(record.mediaMimeType ?? record.media_mime_type) || undefined,
    artifactId: text(record.artifactId ?? record.artifact_id) || undefined,
    metadata: isRecord(record.metadata) ? record.metadata as NimiRuntimeAgentSessionTranscriptMessage['metadata'] : undefined,
  };
}

function normalizeTurnSnapshot(value: unknown): NimiRuntimeAgentSessionTurnSnapshot | undefined {
  const record = isRecord(value) ? value : {};
  const turnId = text(record.turnId ?? record.turn_id);
  if (!turnId) return undefined;
  return {
    turnId,
    streamId: text(record.streamId ?? record.stream_id) || undefined,
    status: text(record.status) || undefined,
    updatedAt: text(record.updatedAt ?? record.updated_at) || undefined,
    messageId: text(record.messageId ?? record.message_id) || undefined,
    text: text(record.text) || undefined,
  };
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function hydrationFailure(input: HydrationInput, error: unknown): HydrationInput['currentChat'] {
  const record = isRecord(error) ? error : {};
  return {
    ...input.currentChat,
    ready: false,
    state: 'failed',
    reasonCode: text(record.reasonCode) || 'zhiyu-conversation-snapshot-hydration-failed',
    actionHint: text(record.actionHint) || 'retry_local_app_conversation_snapshot',
    source: text(record.source) || 'sdk',
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime conversation snapshot hydration failed.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.conversationAnchorId,
    messageCount: input.currentChat.messages.length,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
