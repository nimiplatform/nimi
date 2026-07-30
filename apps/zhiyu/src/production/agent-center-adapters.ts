import {
  createPermissionedAgentCenterSession,
  type AgentCenterOpaqueHandle,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';
import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';
import { requestZhiyuDesktopOpenAgentConfig } from '../shell/desktop-open/desktop-open-action.js';
import { createZhiyuAgentCenterPermissionedSdkSurface } from './agent-center-permissioned-binding.js';

export function createZhiyuProductionAgentCenterSession(evidence: ZhiyuEvidence): AgentCenterSession | null {
  const handle = materializedAgentHandle(evidence);
  if (!handle) return null;
  const client = getZhiyuLocalAppClient();
  return createPermissionedAgentCenterSession({
    handle,
    surface: createZhiyuAgentCenterPermissionedSdkSurface({
      agentConfigure: client.agentConfigure,
      permissions: client.permissions,
      loadPosture: () => client.permissions.agentCapabilityPosture(),
      openPermissionSettings: async () => { await requestZhiyuDesktopOpenAgentConfig(); },
    }),
  });
}

function materializedAgentHandle(evidence: ZhiyuEvidence): AgentCenterOpaqueHandle | null {
  const handle = evidence.conversation.agentHandle?.trim()
    || evidence.localAgent.agentHandle?.trim()
    || '';
  const covered = evidence.inventory.localAgents.some((agent) => agent.agentHandle === handle);
  return handle && covered ? handle as AgentCenterOpaqueHandle : null;
}
