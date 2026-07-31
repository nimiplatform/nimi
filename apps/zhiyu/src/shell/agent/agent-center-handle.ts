import type { AgentCenterOpaqueHandle } from '@nimiplatform/kit/features/agent-center';

import type { ZhiyuEvidence } from '../app/evidence.js';

export function projectZhiyuAuthorizedAgentCenterHandle(
  evidence: Pick<ZhiyuEvidence, 'conversation' | 'localAgent' | 'inventory'>,
): AgentCenterOpaqueHandle | null {
  const agentHandle = evidence.conversation.agentHandle?.trim()
    || evidence.localAgent.agentHandle?.trim()
    || '';
  const covered = evidence.inventory.localAgents.some((agent) => agent.agentHandle === agentHandle);
  return agentHandle && covered ? agentHandle as AgentCenterOpaqueHandle : null;
}
