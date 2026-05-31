import { getPlatformClient } from '@nimiplatform/sdk';
import { attachRuntimeAppDataStorageRoot } from '@nimiplatform/sdk/runtime';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
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

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

async function chatAiStoragePayload<T extends object>(
  input: T,
): Promise<T & { storageRoot: string }> {
  const runtime = getPlatformClient().runtime;
  return attachRuntimeAppDataStorageRoot({
    appLifecycle: runtime.appLifecycle,
    appId: runtime.appId,
    label: 'desktop Nimi Chat',
    payload: input,
  });
}

export async function listThreads(): Promise<ChatAiThreadSummary[]> {
  requireTauri('chat_ai_list_threads');
  return invokeChecked('chat_ai_list_threads', {
    payload: await chatAiStoragePayload({}),
  }, parseChatAiThreadSummaries);
}

export async function getThreadBundle(threadId: string): Promise<ChatAiThreadBundle | null> {
  requireTauri('chat_ai_get_thread_bundle');
  return invokeChecked('chat_ai_get_thread_bundle', {
    payload: await chatAiStoragePayload({ threadId }),
  }, parseChatAiThreadBundle);
}

export async function createThread(input: ChatAiCreateThreadInput): Promise<ChatAiThreadRecord> {
  requireTauri('chat_ai_create_thread');
  return invokeChecked('chat_ai_create_thread', {
    payload: await chatAiStoragePayload(parseChatAiCreateThreadInput(input)),
  }, parseChatAiThreadRecord);
}

export async function updateThreadMetadata(input: ChatAiUpdateThreadMetadataInput): Promise<ChatAiThreadRecord> {
  requireTauri('chat_ai_update_thread_metadata');
  return invokeChecked('chat_ai_update_thread_metadata', {
    payload: await chatAiStoragePayload(parseChatAiUpdateThreadMetadataInput(input)),
  }, parseChatAiThreadRecord);
}

export async function createMessage(input: ChatAiCreateMessageInput): Promise<ChatAiMessageRecord> {
  requireTauri('chat_ai_create_message');
  return invokeChecked('chat_ai_create_message', {
    payload: await chatAiStoragePayload(parseChatAiCreateMessageInput(input)),
  }, parseChatAiMessageRecord);
}

export async function updateMessage(input: ChatAiUpdateMessageInput): Promise<ChatAiMessageRecord> {
  requireTauri('chat_ai_update_message');
  return invokeChecked('chat_ai_update_message', {
    payload: await chatAiStoragePayload(parseChatAiUpdateMessageInput(input)),
  }, parseChatAiMessageRecord);
}

export async function getDraft(threadId: string): Promise<ChatAiDraftRecord | null> {
  requireTauri('chat_ai_get_draft');
  return invokeChecked('chat_ai_get_draft', {
    payload: await chatAiStoragePayload({ threadId }),
  }, (value) => (value == null ? null : parseChatAiDraftRecord(value)));
}

export async function putDraft(input: ChatAiPutDraftInput): Promise<ChatAiDraftRecord> {
  requireTauri('chat_ai_put_draft');
  return invokeChecked('chat_ai_put_draft', {
    payload: await chatAiStoragePayload(parseChatAiPutDraftInput(input)),
  }, parseChatAiDraftRecord);
}

export async function deleteDraft(threadId: string): Promise<void> {
  requireTauri('chat_ai_delete_draft');
  await invokeChecked('chat_ai_delete_draft', {
    payload: await chatAiStoragePayload({ threadId }),
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
