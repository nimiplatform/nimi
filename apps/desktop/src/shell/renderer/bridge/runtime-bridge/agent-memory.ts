import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentMemoryBindStandardResult,
  type AgentMemoryBindStandardPayload,
  type AgentMemoryBindStandardResult,
} from './types';

export async function bindAgentMemoryStandard(
  payload: AgentMemoryBindStandardPayload,
): Promise<AgentMemoryBindStandardResult> {
  if (!hasTauriInvoke()) {
    throw new Error('agent_memory_bind_standard requires Tauri runtime');
  }
  return invokeChecked('agent_memory_bind_standard', { payload }, parseAgentMemoryBindStandardResult);
}
