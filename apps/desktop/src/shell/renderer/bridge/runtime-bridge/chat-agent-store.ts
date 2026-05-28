import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentLocalCommitTurnResult,
  parseAgentLocalCommitTurnResultInput,
  parseAgentLocalCreateThreadInput,
  parseAgentLocalThreadBundle,
  parseAgentLocalThreadRecord,
  parseAgentLocalThreadSummaries,
  type AgentLocalCommitTurnResult,
  type AgentLocalCommitTurnResultInput,
  type AgentLocalCreateThreadInput,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
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

export async function commitTurnResult(input: AgentLocalCommitTurnResultInput): Promise<AgentLocalCommitTurnResult> {
  requireTauri('chat_agent_commit_turn_result');
  return invokeChecked('chat_agent_commit_turn_result', {
    payload: parseAgentLocalCommitTurnResultInput(input),
  }, parseAgentLocalCommitTurnResult);
}

export const chatAgentStoreClient = {
  listThreads,
  getThreadBundle,
  createThread,
  commitTurnResult,
};
