import {
  createAgentCenterShellHostMechanics,
  createAgentCenterBrowserHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import {
  createAgentCenterShellBridge,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import type { ZhiyuAgentCenterBinding } from '../renderer/contract.js';
import { getZhiyuLocalAppClient, isZhiyuRemoteCarrier } from '../shell/auth/runtime-platform.js';
import { ZHIYU_RESOURCE_PACK_LIMITS } from '../resource-pack/contract.js';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r008
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r009
export function resolveZhiyuProductionAgentCenterBinding(
  agentHandle: NimiLocalAppAgentHandle | null,
  localAppClient = getZhiyuLocalAppClient(),
): ZhiyuAgentCenterBinding | null {
  if (!agentHandle) return null;
  return Object.freeze({
    agentHandle,
    client: localAppClient.agentConfigure,
    hostMechanics: isZhiyuRemoteCarrier()
      ? createAgentCenterBrowserHostMechanics({ maxResourcePackBytes: ZHIYU_RESOURCE_PACK_LIMITS.archiveBytes })
      : hasElectronInvoke()
      ? createAgentCenterShellHostMechanics(createAgentCenterShellBridge())
      : null,
  });
}
