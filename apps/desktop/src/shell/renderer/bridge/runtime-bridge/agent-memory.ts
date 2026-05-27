import { invokeTauri } from '@runtime/tauri-api';
import {
  parseAgentMemoryStandardFixtureStatusResult,
  type AgentMemoryStandardFixtureStatusPayload,
  type AgentMemoryStandardFixtureStatusResult,
} from './types';

function isTauriRuntimeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /RUNTIME_UNAVAILABLE|TAURI_RUNTIME_UNAVAILABLE|Tauri invoke unavailable|__TAURI__|__TAURI_INTERNALS__|window is not defined|not.*Tauri|outside.*Tauri/i
    .test(message);
}

function emptyAgentMemoryStandardFixtureStatus(): AgentMemoryStandardFixtureStatusResult {
  return { available: false, alreadyBound: false, bank: {} };
}

export async function getAgentMemoryStandardFixtureStatus(
  payload: AgentMemoryStandardFixtureStatusPayload,
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
