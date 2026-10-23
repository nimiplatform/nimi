import type { AgentLocalThreadBundle, AgentLocalThreadRecord } from '../../bridge/runtime-bridge/types';

export function createEmptyAgentThreadBundle(
  thread: AgentLocalThreadRecord,
): AgentLocalThreadBundle {
  return {
    thread,
    messages: [],
  };
}
