import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import type { ZhiyuEvidence } from '../app/evidence.js';

export function projectZhiyuAuthorizedAgentCenterHandle(
  evidence: Pick<ZhiyuEvidence, 'conversation' | 'localAgent' | 'inventory'>,
): NimiLocalAppAgentHandle | null {
  const agentHandle = evidence.conversation.agentHandle
    ?? evidence.localAgent.agentHandle;
  if (!agentHandle) return null;
  const covered = evidence.inventory.localAgents.some((agent) => agent.agentHandle === agentHandle);
  return covered ? agentHandle : null;
}
