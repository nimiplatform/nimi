import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseAgentMemoryBindStandardResult,
  parseAgentMemoryStandardFixtureStatusResult,
  type AgentMemoryBindStandardPayload,
  type AgentMemoryBindStandardResult,
  type AgentMemoryStandardFixtureStatusResult,
} from './types';

export async function bindAgentMemoryStandard(
  payload: AgentMemoryBindStandardPayload,
): Promise<AgentMemoryBindStandardResult> {
  if (!hasTauriInvoke()) {
    throw new Error('agent_memory_bind_standard requires Tauri runtime');
  }
  return invokeChecked('agent_memory_bind_standard', { payload }, parseAgentMemoryBindStandardResult);
}

export async function getAgentMemoryStandardFixtureStatus(
  payload: AgentMemoryBindStandardPayload,
): Promise<AgentMemoryStandardFixtureStatusResult> {
  if (!hasTauriInvoke()) {
    return { available: false, alreadyBound: false, bank: {} };
  }
  return invokeChecked(
    'agent_memory_standard_fixture_status_get',
    { payload },
    parseAgentMemoryStandardFixtureStatusResult,
  );
}
