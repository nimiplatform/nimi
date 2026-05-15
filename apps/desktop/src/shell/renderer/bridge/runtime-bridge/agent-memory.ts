import { invokeTauri } from '@runtime/tauri-api';
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
  try {
    const result = await invokeTauri('agent_memory_bind_standard', { payload });
    return parseAgentMemoryBindStandardResult(result);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      throw new Error('agent_memory_bind_standard requires Tauri runtime', { cause: error });
    }
    throw error;
  }
}

function isTauriRuntimeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /RUNTIME_UNAVAILABLE|TAURI_RUNTIME_UNAVAILABLE|Tauri invoke unavailable|__TAURI__|__TAURI_INTERNALS__|window is not defined|not.*Tauri|outside.*Tauri/i
    .test(message);
}

function emptyAgentMemoryStandardFixtureStatus(): AgentMemoryStandardFixtureStatusResult {
  return { available: false, alreadyBound: false, bank: {} };
}

export async function getAgentMemoryStandardFixtureStatus(
  payload: AgentMemoryBindStandardPayload,
): Promise<AgentMemoryStandardFixtureStatusResult> {
  try {
    const result = await invokeTauri('agent_memory_standard_fixture_status_get', { payload });
    return parseAgentMemoryStandardFixtureStatusResult(result);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      return emptyAgentMemoryStandardFixtureStatus();
    }
    throw error;
  }
}
