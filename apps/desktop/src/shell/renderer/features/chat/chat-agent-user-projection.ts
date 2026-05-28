import type {
  AgentLocalMessageRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentChatUserAttachment } from './chat-agent-runtime-turn-types';
import { RUNTIME_AGENT_CHAT_MODE_ID } from './chat-agent-runtime-mode';

function normalizeText(value: string): string {
  return value.trim();
}

export function buildAgentUserProjection(input: {
  threadId: string;
  agentId: string;
  conversationAnchorId: string;
  turnId: string;
  submittedText: string;
  uploadedAttachments: readonly AgentChatUserAttachment[];
  createdAtMs: number;
}): {
  messages: AgentLocalMessageRecord[];
  firstMessageId: string;
  lastMessageId: string;
  lastMessageAtMs: number;
} {
  const messages: AgentLocalMessageRecord[] = [];
  const submittedText = normalizeText(input.submittedText);
  let messageIndex = 0;
  let previousMessageId: string | null = null;

  if (submittedText) {
    const textMessageId = `${input.turnId}:message:${messageIndex}`;
    messages.push({
      id: textMessageId,
      threadId: input.threadId,
      role: 'user',
      status: 'complete',
      kind: 'text',
      contentText: submittedText,
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      mediaUrl: null,
      mediaMimeType: null,
      artifactId: null,
      metadataJson: {
        transport: 'runtime.agent.turns',
        agentId: input.agentId,
        conversationAnchorId: input.conversationAnchorId,
      },
      createdAtMs: input.createdAtMs,
      updatedAtMs: input.createdAtMs,
    });
    previousMessageId = textMessageId;
    messageIndex += 1;
  }

  input.uploadedAttachments.forEach((attachment) => {
    const messageId = `${input.turnId}:message:${messageIndex}`;
    const messageAtMs = input.createdAtMs + messageIndex;
    messages.push({
      id: messageId,
      threadId: input.threadId,
      role: 'user',
      status: 'complete',
      kind: 'image',
      contentText: '',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: previousMessageId,
      mediaUrl: attachment.url,
      mediaMimeType: attachment.mimeType,
      artifactId: attachment.resourceId,
      metadataJson: {
        transport: 'runtime.agent.turns',
        agentId: input.agentId,
        conversationAnchorId: input.conversationAnchorId,
      },
      createdAtMs: messageAtMs,
      updatedAtMs: messageAtMs,
    });
    previousMessageId = messageId;
    messageIndex += 1;
  });

  const firstMessageId = messages[0]?.id;
  const lastMessageId = messages[messages.length - 1]?.id;
  const lastMessageAtMs = messages[messages.length - 1]?.updatedAtMs;
  if (!firstMessageId || !lastMessageId || lastMessageAtMs == null) {
    throw new Error(`${RUNTIME_AGENT_CHAT_MODE_ID} requires a user projection message`);
  }

  return {
    messages,
    firstMessageId,
    lastMessageId,
    lastMessageAtMs,
  };
}
