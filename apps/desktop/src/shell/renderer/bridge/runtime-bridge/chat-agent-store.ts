import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentLocalCreateMessageInput,
  parseAgentLocalCreateThreadInput,
  parseAgentLocalDraftRecord,
  parseAgentLocalMessageRecord,
  parseAgentLocalPutDraftInput,
  parseAgentLocalThreadBundle,
  parseAgentLocalThreadRecord,
  parseAgentLocalThreadSummaries,
  parseAgentLocalUpdateMessageInput,
  parseAgentLocalUpdateThreadMetadataInput,
  type AgentLocalCreateMessageInput,
  type AgentLocalCreateThreadInput,
  type AgentLocalDraftRecord,
  type AgentLocalMessageRecord,
  type AgentLocalPutDraftInput,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
  type AgentLocalUpdateMessageInput,
  type AgentLocalUpdateThreadMetadataInput,
} from './types';

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

export async function listThreads(): Promise<AgentLocalThreadSummary[]> {
  requireTauri('chat_agent_list_threads');
  return invokeChecked('chat_agent_list_threads', {}, parseAgentLocalThreadSummaries);
}

export async function getThreadBundle(threadId: string): Promise<AgentLocalThreadBundle | null> {
  requireTauri('chat_agent_get_thread_bundle');
  return invokeChecked('chat_agent_get_thread_bundle', {
    payload: { threadId },
  }, parseAgentLocalThreadBundle);
}

export async function createThread(input: AgentLocalCreateThreadInput): Promise<AgentLocalThreadRecord> {
  requireTauri('chat_agent_create_thread');
  return invokeChecked('chat_agent_create_thread', {
    payload: parseAgentLocalCreateThreadInput(input),
  }, parseAgentLocalThreadRecord);
}

export async function updateThreadMetadata(input: AgentLocalUpdateThreadMetadataInput): Promise<AgentLocalThreadRecord> {
  requireTauri('chat_agent_update_thread_metadata');
  return invokeChecked('chat_agent_update_thread_metadata', {
    payload: parseAgentLocalUpdateThreadMetadataInput(input),
  }, parseAgentLocalThreadRecord);
}

export async function createMessage(input: AgentLocalCreateMessageInput): Promise<AgentLocalMessageRecord> {
  requireTauri('chat_agent_create_message');
  return invokeChecked('chat_agent_create_message', {
    payload: parseAgentLocalCreateMessageInput(input),
  }, parseAgentLocalMessageRecord);
}

export async function updateMessage(input: AgentLocalUpdateMessageInput): Promise<AgentLocalMessageRecord> {
  requireTauri('chat_agent_update_message');
  return invokeChecked('chat_agent_update_message', {
    payload: parseAgentLocalUpdateMessageInput(input),
  }, parseAgentLocalMessageRecord);
}

export async function getDraft(threadId: string): Promise<AgentLocalDraftRecord | null> {
  requireTauri('chat_agent_get_draft');
  return invokeChecked('chat_agent_get_draft', {
    payload: { threadId },
  }, (value) => (value == null ? null : parseAgentLocalDraftRecord(value)));
}

export async function putDraft(input: AgentLocalPutDraftInput): Promise<AgentLocalDraftRecord> {
  requireTauri('chat_agent_put_draft');
  return invokeChecked('chat_agent_put_draft', {
    payload: parseAgentLocalPutDraftInput(input),
  }, parseAgentLocalDraftRecord);
}

export async function deleteDraft(threadId: string): Promise<void> {
  requireTauri('chat_agent_delete_draft');
  await invokeChecked('chat_agent_delete_draft', {
    payload: { threadId },
  }, () => undefined);
}

export const chatAgentStoreClient = {
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
