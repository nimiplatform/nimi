import {
  createAppAgentCenterSession,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { AgentCenterResourcePackTargetController } from '@nimiplatform/kit/features/agent-center';

import type { ZhiyuAgentCenterBinding } from './contract.js';

export function createZhiyuCanonicalAgentCenterSession(
  agentHandle: NimiLocalAppAgentHandle | null,
  conversationAnchorId: string | null,
  binding: ZhiyuAgentCenterBinding | null,
  resourcePackTargetController: AgentCenterResourcePackTargetController,
): AgentCenterSession | null {
  if (!agentHandle || !binding || binding.agentHandle !== agentHandle) return null;
  return createAppAgentCenterSession({
    handle: agentHandle,
    client: binding.client,
    ...(conversationAnchorId ? { conversationAnchorId } : {}),
    hostMechanics: binding.hostMechanics,
    resourcePackTargetController,
  });
}
