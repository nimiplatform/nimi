import { invokeChecked } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  parseChatAiCreateMessageInput,
  parseChatAiCreateThreadInput,
  parseChatAiDraftRecord,
  parseChatAiMessageRecord,
  parseChatAiPutDraftInput,
  parseChatAiThreadBundle,
  parseChatAiThreadRecord,
  parseChatAiThreadSummaries,
  parseChatAiUpdateMessageInput,
  parseChatAiUpdateThreadMetadataInput,
  type ChatAiCreateMessageInput,
  type ChatAiCreateThreadInput,
  type ChatAiDraftRecord,
  type ChatAiMessageRecord,
  type ChatAiPutDraftInput,
  type ChatAiThreadBundle,
  type ChatAiThreadRecord,
  type ChatAiThreadSummary,
  type ChatAiUpdateMessageInput,
  type ChatAiUpdateThreadMetadataInput,
} from './types';

export async function listThreads(): Promise<ChatAiThreadSummary[]> {
  return invokeChecked('chat_ai_list_threads', {
    payload: {},
  }, parseChatAiThreadSummaries);
}

export async function getThreadBundle(threadId: string): Promise<ChatAiThreadBundle | null> {
  return invokeChecked('chat_ai_get_thread_bundle', {
    payload: { threadId },
  }, parseChatAiThreadBundle);
}

export async function createThread(input: ChatAiCreateThreadInput): Promise<ChatAiThreadRecord> {
  return invokeChecked('chat_ai_create_thread', {
    payload: parseChatAiCreateThreadInput(input),
  }, parseChatAiThreadRecord);
}

export async function updateThreadMetadata(input: ChatAiUpdateThreadMetadataInput): Promise<ChatAiThreadRecord> {
  return invokeChecked('chat_ai_update_thread_metadata', {
    payload: parseChatAiUpdateThreadMetadataInput(input),
  }, parseChatAiThreadRecord);
}

export async function createMessage(input: ChatAiCreateMessageInput): Promise<ChatAiMessageRecord> {
  return invokeChecked('chat_ai_create_message', {
    payload: parseChatAiCreateMessageInput(input),
  }, parseChatAiMessageRecord);
}

export async function updateMessage(input: ChatAiUpdateMessageInput): Promise<ChatAiMessageRecord> {
  return invokeChecked('chat_ai_update_message', {
    payload: parseChatAiUpdateMessageInput(input),
  }, parseChatAiMessageRecord);
}

export async function getDraft(threadId: string): Promise<ChatAiDraftRecord | null> {
  return invokeChecked('chat_ai_get_draft', {
    payload: { threadId },
  }, (value) => (value == null ? null : parseChatAiDraftRecord(value)));
}

export async function putDraft(input: ChatAiPutDraftInput): Promise<ChatAiDraftRecord> {
  return invokeChecked('chat_ai_put_draft', {
    payload: parseChatAiPutDraftInput(input),
  }, parseChatAiDraftRecord);
}

export async function deleteDraft(threadId: string): Promise<void> {
  await invokeChecked('chat_ai_delete_draft', {
    payload: { threadId },
  }, () => undefined);
}

export const chatAiStoreClient = {
  listThreads,
  getThreadBundle,
  createThread,
  updateThreadMetadata,
  createMessage,
  updateMessage,
  getDraft,
  putDraft,
  deleteDraft,
};
