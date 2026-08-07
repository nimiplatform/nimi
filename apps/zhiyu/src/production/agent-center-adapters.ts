import type {
  AgentCenterOpaqueHandle,
  AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';

export function createZhiyuProductionAgentCenterSession(
  _agentHandle: AgentCenterOpaqueHandle | null,
): AgentCenterSession | null {
  // The typed local App Agent surface has no configuration authority.
  return null;
}
