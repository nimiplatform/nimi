import {
  createPermissionedAgentCenterSession,
  type AgentCenterOpaqueHandle,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';
import { createZhiyuAgentCenterPermissionedSdkSurface } from './agent-center-permissioned-binding.js';

export function createZhiyuProductionAgentCenterSession(
  agentHandle: AgentCenterOpaqueHandle | null,
): AgentCenterSession | null {
  if (!agentHandle) return null;
  const client = getZhiyuLocalAppClient();
  return createPermissionedAgentCenterSession({
    handle: agentHandle,
    surface: createZhiyuAgentCenterPermissionedSdkSurface({
      agentConfigure: client.agentConfigure,
      aiProfiles: {
        async list() { return []; },
        async get() { return null; },
      },
      permissions: client.permissions,
      loadPosture: () => client.permissions.agentCapabilityPosture(),
    }),
  });
}
