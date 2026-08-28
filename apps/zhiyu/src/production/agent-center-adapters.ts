import {
  createAgentCenterShellHostMechanics,
  createAppAgentCenterSession,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import {
  createAgentCenterShellBridge,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r008
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r009
export function createZhiyuProductionAgentCenterSession(
  agentHandle: NimiLocalAppAgentHandle | null,
  conversationAnchorId: string | null = null,
): AgentCenterSession | null {
  if (!agentHandle) return null;
  const localAppClient = getZhiyuLocalAppClient();
  return createAppAgentCenterSession({
    handle: agentHandle,
    client: localAppClient.agentConfigure,
    ...(conversationAnchorId ? { conversationAnchorId } : {}),
    hostMechanics: hasElectronInvoke()
      ? createAgentCenterShellHostMechanics(createAgentCenterShellBridge())
      : null,
  });
}
