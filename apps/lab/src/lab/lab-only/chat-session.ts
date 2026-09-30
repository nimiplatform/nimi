import type {
  AppAiChatMessage,
  AppAiChatSessionMessage,
} from '@nimiplatform/kit/features/chat/runtime';
import {
  labTextConversationHistory,
  type LabTextConversationDocument,
  type LabTextConversationMessage,
} from './text-conversation.js';

// The session hook's conversation is one App document in the Conversation
// page's shape, under its own path. The App owns it: it saves settled
// messages and builds each request's history itself.
export const LAB_CHAT_SESSION_PATH = 'lab-chat-session.json';

/** Settled session messages as the saved document. */
export function toLabChatSessionDocument(messages: readonly AppAiChatSessionMessage[]): LabTextConversationDocument {
  return {
    version: 1,
    messages: messages.map((message): LabTextConversationMessage => {
      if (message.status === 'streaming') throw new Error('A reply that is still streaming is not saved.');
      return {
        id: message.id,
        role: message.role,
        text: message.content,
        createdAt: message.timestamp,
        ...(message.status === 'error' ? { status: 'failed' as const } : message.status === 'canceled' ? { status: 'stopped' as const } : {}),
        ...(message.role === 'assistant' && message.status === 'complete' && message.outputItems ? { outputItems: message.outputItems } : {}),
      };
    }),
  };
}

export function fromLabChatSessionDocument(document: LabTextConversationDocument): AppAiChatSessionMessage[] {
  return document.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.text,
    timestamp: message.createdAt,
    status: message.status === 'failed' ? 'error' : message.status === 'stopped' ? 'canceled' : 'complete',
    ...(message.outputItems ? { outputItems: message.outputItems } : {}),
  }));
}

/**
 * What a prompt sends: the completed exchanges before it, each reply with its
 * ordered output, then the prompt. Failed or stopped replies are not
 * returned. The hook passes the new prompt as the last session message.
 */
export function labChatSessionInput(messages: readonly AppAiChatSessionMessage[], prompt: string): AppAiChatMessage[] {
  const earlier = toLabChatSessionDocument(messages.slice(0, -1)).messages;
  return [
    ...labTextConversationHistory(earlier).map((message): AppAiChatMessage => ({
      role: message.role,
      content: message.text,
      ...(message.outputItems ? { outputItems: message.outputItems } : {}),
    })),
    { role: 'user', content: prompt },
  ];
}
