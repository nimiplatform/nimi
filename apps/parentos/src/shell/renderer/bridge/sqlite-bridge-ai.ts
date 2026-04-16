import { invoke } from '@tauri-apps/api/core';

export interface ConversationRow {
  conversationId: string;
  childId: string;
  title: string | null;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export function createConversation(params: {
  conversationId: string;
  childId: string;
  title: string | null;
  now: string;
}) {
  return invoke<void>('create_conversation', params);
}

export function getConversations(childId: string) {
  return invoke<ConversationRow[]>('get_conversations', { childId });
}

export interface AiMessageRow {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  createdAt: string;
}

export function insertAiMessage(params: {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  now: string;
}) {
  return invoke<void>('insert_ai_message', params);
}

export function getAiMessages(conversationId: string) {
  return invoke<AiMessageRow[]>('get_ai_messages', { conversationId });
}
