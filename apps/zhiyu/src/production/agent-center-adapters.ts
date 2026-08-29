import {
  createAgentCenterShellHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import {
  createAgentCenterShellBridge,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import type { ZhiyuAgentCenterBinding } from '../renderer/contract.js';
import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r008
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r009
export function resolveZhiyuProductionAgentCenterBinding(
  agentHandle: NimiLocalAppAgentHandle | null,
): ZhiyuAgentCenterBinding | null {
  if (!agentHandle) return null;
  const localAppClient = getZhiyuLocalAppClient();
  return Object.freeze({
    agentHandle,
    client: localAppClient.agentConfigure,
    hostMechanics: hasElectronInvoke()
      ? createAgentCenterShellHostMechanics(createAgentCenterShellBridge())
      : null,
  });
}
