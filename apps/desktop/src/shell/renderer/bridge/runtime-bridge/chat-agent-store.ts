import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentLocalCancelTurnInput,
  parseAgentLocalCommitTurnResult,
  parseAgentLocalCommitTurnResultInput,
  parseAgentLocalCreateThreadInput,
  parseAgentLocalDraftRecord,
  parseAgentLocalProjectionRebuildResult,
  parseAgentLocalPutDraftInput,
  parseAgentLocalThreadBundle,
  parseAgentLocalThreadRecord,
  parseAgentLocalThreadSummaries,
  parseAgentLocalTurnRecord,
  parseAgentLocalUpdateThreadMetadataInput,
  type AgentLocalCancelTurnInput,
  type AgentLocalCommitTurnResult,
  type AgentLocalCommitTurnResultInput,
  type AgentLocalCreateThreadInput,
  type AgentLocalDraftRecord,
  type AgentLocalProjectionRebuildResult,
  type AgentLocalPutDraftInput,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
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
  putDraft,
  deleteDraft,
  deleteThread,
  commitTurnResult,
  cancelTurn,
  rebuildProjection,
};
