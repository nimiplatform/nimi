import type {
  NimiLocalAppClient,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';

import type { ZhiyuCanonicalRendererBindings } from '../renderer/contract.js';
import { hydrateZhiyuAgentChatFromLocalAppConversationSnapshot } from '../shell/agent-chat/agent-conversation-state.js';
import { zhiyuArtifactDataUrl } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';

type HydrationInput = Parameters<
  ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']
>[0];

type ConversationSnapshotPort = Pick<NimiLocalAppClient['conversation'], 'snapshot' | 'readArtifact'>;

export async function hydrateZhiyuProductionConversation(
  input: HydrationInput,
  conversation: ConversationSnapshotPort,
): Promise<Pick<ZhiyuEvidence, 'source' | 'chat'>> {
  try {
    const snapshot = await conversation.snapshot({
      agentHandle: input.agentHandle as Parameters<ConversationSnapshotPort['snapshot']>[0]['agentHandle'],
      conversationAnchorId: input.conversationAnchorId,
    });
    const chat = hydrateZhiyuAgentChatFromLocalAppConversationSnapshot({
      current: input.currentChat,
      agentHandle: input.agentHandle,
      conversationAnchorId: input.conversationAnchorId,
      snapshot: snapshot as NimiLocalAppConversationSnapshot,
    });
    let messages = await Promise.all(chat.messages.map(async (message) => {
      const artifactId = typeof message.metadata?.artifactId === 'string'
        ? message.metadata.artifactId
        : '';
      if (message.kind !== 'image' || !artifactId) return message;
      try {
        const artifact = await conversation.readArtifact({
          agentHandle: input.agentHandle as Parameters<ConversationSnapshotPort['readArtifact']>[0]['agentHandle'],
          conversationAnchorId: input.conversationAnchorId,
          artifactId,
        });
        return {
          ...message,
          metadata: {
            ...message.metadata,
            mediaUrl: zhiyuArtifactDataUrl(artifact.bytes, artifact.mimeType),
          },
        };
      } catch {
        return {
          ...message,
          metadata: { ...message.metadata, mediaError: 'Conversation image is unavailable.' },
        };
      }
    }));
    for (const voice of snapshot.voices) {
      const index = messages.findIndex((message) => message.id === voice.messageId);
      if (index < 0) continue;
      const message = messages[index];
      if (!message) continue;
      if (voice.state === 'failed') {
        messages = messages.map((candidate, candidateIndex) => candidateIndex === index
          ? { ...candidate, metadata: { ...candidate.metadata, voiceError: voice.reasonCode } }
          : candidate);
        continue;
      }
      if (!voice.artifactId) continue;
      try {
        const artifact = await conversation.readArtifact({
          agentHandle: input.agentHandle as Parameters<ConversationSnapshotPort['readArtifact']>[0]['agentHandle'],
          conversationAnchorId: input.conversationAnchorId,
          artifactId: voice.artifactId,
        });
        messages = messages.map((candidate, candidateIndex) => candidateIndex === index
          ? {
            ...candidate,
            kind: 'voice',
            metadata: {
              ...candidate.metadata,
              voiceArtifactId: voice.artifactId,
              voiceUrl: zhiyuArtifactDataUrl(artifact.bytes, artifact.mimeType),
              voiceTranscript: candidate.text,
            },
          }
          : candidate);
      } catch {
        messages = messages.map((candidate, candidateIndex) => candidateIndex === index
          ? { ...candidate, metadata: { ...candidate.metadata, voiceError: 'Conversation voice is unavailable.' } }
          : candidate);
      }
    }
    return {
      source: input.currentSource,
      chat: { ...chat, messages },
    };
  } catch (error) {
    return {
      source: input.currentSource,
      chat: hydrationFailure(input, error),
    };
  }
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
    agentHandle: input.agentHandle,
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
