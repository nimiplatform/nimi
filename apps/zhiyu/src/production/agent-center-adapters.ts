import type {
  AgentCenterOpaqueHandle,
  AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';

export function createZhiyuProductionAgentCenterSession(
  _agentHandle: AgentCenterOpaqueHandle | null,
): AgentCenterSession | null {
  // Protected App-side Agent configuration remains unavailable until IMP2.
  return null;
}
