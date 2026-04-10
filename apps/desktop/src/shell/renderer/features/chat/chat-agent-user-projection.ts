import type {
  AgentLocalMessageRecord,
  AgentLocalTurnBeatInput,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentChatUserAttachment } from './chat-ai-execution-engine';

function normalizeText(value: string): string {
  return value.trim();
}

export function buildAgentUserProjectionCommit(input: {
  threadId: string;
  turnId: string;
  submittedText: string;
  uploadedAttachments: readonly AgentChatUserAttachment[];
  createdAtMs: number;
}): {
  messages: AgentLocalMessageRecord[];
  beats: AgentLocalTurnBeatInput[];
  firstMessageId: string;
  lastMessageId: string;
  lastMessageAtMs: number;
} {
  const messages: AgentLocalMessageRecord[] = [];
  const beats: AgentLocalTurnBeatInput[] = [];
  const submittedText = normalizeText(input.submittedText);
  let messageIndex = 0;
  let beatIndex = 0;
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
      metadataJson: null,
      createdAtMs: input.createdAtMs,
      updatedAtMs: input.createdAtMs,
    });
    beats.push({
      id: `${input.turnId}:beat:${beatIndex}`,
      turnId: input.turnId,
      beatIndex,
      modality: 'text',
      status: 'delivered',
      textShadow: submittedText,
      artifactId: null,
      mimeType: 'text/plain',
      mediaUrl: null,
      projectionMessageId: textMessageId,
      createdAtMs: input.createdAtMs,
      deliveredAtMs: input.createdAtMs,
    });
    previousMessageId = textMessageId;
    messageIndex += 1;
    beatIndex += 1;
  }

  input.uploadedAttachments.forEach((attachment, index) => {
    const messageId = `${input.turnId}:message:${messageIndex}`;
    const messageAtMs = input.createdAtMs + beatIndex;
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
      metadataJson: null,
      createdAtMs: messageAtMs,
      updatedAtMs: messageAtMs,
    });
    beats.push({
      id: `${input.turnId}:beat:${beatIndex}`,
      turnId: input.turnId,
      beatIndex,
      modality: 'image',
      status: 'delivered',
      textShadow: null,
      artifactId: attachment.resourceId,
      mimeType: attachment.mimeType,
      mediaUrl: attachment.url,
      projectionMessageId: messageId,
      createdAtMs: messageAtMs,
      deliveredAtMs: messageAtMs,
    });
    previousMessageId = messageId;
    messageIndex += 1;
    beatIndex += 1;
    void index;
  });

  const firstMessageId = messages[0]?.id;
  const lastMessageId = messages[messages.length - 1]?.id;
  const lastMessageAtMs = messages[messages.length - 1]?.updatedAtMs;
  if (!firstMessageId || !lastMessageId || lastMessageAtMs == null) {
    throw new Error('agent-local-chat-v1 requires a user projection message');
  }

  return {
    messages,
    beats,
    firstMessageId,
    lastMessageId,
    lastMessageAtMs,
  };
}
