import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentLocalCancelTurnInput,
  parseAgentLocalCommitTurnResult,
  parseAgentLocalCommitTurnResultInput,
  parseAgentLocalCreateMessageInput,
  parseAgentLocalCreateThreadInput,
  parseAgentLocalDraftRecord,
  parseAgentLocalLoadTurnContextInput,
  parseAgentLocalMessageRecord,
  parseAgentLocalProjectionRebuildResult,
  parseAgentLocalPutDraftInput,
  parseAgentLocalThreadBundle,
  parseAgentLocalThreadRecord,
  parseAgentLocalThreadSummaries,
  parseAgentLocalTurnContext,
  parseAgentLocalTurnRecord,
  parseAgentLocalUpdateThreadMetadataInput,
  type AgentLocalCancelTurnInput,
  type AgentLocalCommitTurnResult,
  type AgentLocalCommitTurnResultInput,
  type AgentLocalCreateMessageInput,
  type AgentLocalCreateThreadInput,
  type AgentLocalDraftRecord,
  type AgentLocalLoadTurnContextInput,
  type AgentLocalMessageRecord,
  type AgentLocalProjectionRebuildResult,
  type AgentLocalPutDraftInput,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
  type AgentLocalTurnContext,
  type AgentLocalTurnRecord,
  type AgentLocalUpdateThreadMetadataInput,
} from './types';

type OfflineTier = 'L0' | 'L1' | 'L2';

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

export async function setOfflineTier(tier: OfflineTier): Promise<void> {
  requireTauri('chat_agent_set_offline_tier');
  await invokeChecked('chat_agent_set_offline_tier', {
    payload: { tier },
  }, () => undefined);
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

export async function deleteThread(threadId: string): Promise<void> {
  requireTauri('chat_agent_delete_thread');
  await invokeChecked('chat_agent_delete_thread', {
    payload: { threadId },
  }, () => undefined);
}

export async function deleteMessage(messageId: string): Promise<AgentLocalThreadBundle> {
  requireTauri('chat_agent_delete_message');
  return invokeChecked('chat_agent_delete_message', {
    payload: { messageId },
  }, (value) => {
    const parsed = parseAgentLocalThreadBundle(value);
    if (!parsed) {
      throw new Error('chat_agent_delete_message returned null bundle');
    }
    return parsed;
  });
}

export async function loadTurnContext(input: AgentLocalLoadTurnContextInput): Promise<AgentLocalTurnContext> {
  requireTauri('chat_agent_load_turn_context');
  return invokeChecked('chat_agent_load_turn_context', {
    payload: parseAgentLocalLoadTurnContextInput(input),
  }, parseAgentLocalTurnContext);
}

export async function commitTurnResult(input: AgentLocalCommitTurnResultInput): Promise<AgentLocalCommitTurnResult> {
  requireTauri('chat_agent_commit_turn_result');
  return invokeChecked('chat_agent_commit_turn_result', {
    payload: parseAgentLocalCommitTurnResultInput(input),
  }, parseAgentLocalCommitTurnResult);
}

export async function cancelTurn(input: AgentLocalCancelTurnInput): Promise<AgentLocalTurnRecord> {
  requireTauri('chat_agent_cancel_turn');
  return invokeChecked('chat_agent_cancel_turn', {
    payload: parseAgentLocalCancelTurnInput(input),
  }, parseAgentLocalTurnRecord);
}

export async function rebuildProjection(threadId: string): Promise<AgentLocalProjectionRebuildResult> {
  requireTauri('chat_agent_rebuild_projection');
  return invokeChecked('chat_agent_rebuild_projection', {
    payload: { threadId },
  }, parseAgentLocalProjectionRebuildResult);
}

export const chatAgentStoreClient = {
  setOfflineTier,
  listThreads,
  getThreadBundle,
  createThread,
  updateThreadMetadata,
  createMessage,
  getDraft,
  putDraft,
  deleteDraft,
  deleteThread,
  deleteMessage,
  loadTurnContext,
  commitTurnResult,
  cancelTurn,
  rebuildProjection,
};
