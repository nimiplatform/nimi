import {
  createLocalFirstPartyRuntimeAccountCaller,
  isRuntimeLocalAgentRef,
  parseRuntimeLocalAgentIdentity,
  projectRuntimeLocalAgentIdentity,
  type AccountCaller,
} from '@nimiplatform/sdk/runtime/browser';
import { readNormalizedString } from './app-bootstrap-helpers.js';

export function createAvatarAccountCaller(appId: string): AccountCaller {
  return createLocalFirstPartyRuntimeAccountCaller({ appId });
}

export function resolveLaunchAgentIdentity(input: {
  agentId: string;
  accountId: string;
}): {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
} {
  const agentId = readNormalizedString(input.agentId);
  const accountId = readNormalizedString(input.accountId);
  if (!agentId) {
    throw new Error('avatar launch context is missing agentId');
  }
  if (!accountId) {
    throw new Error('Runtime account projection is required before resolving Avatar launch agent identity');
  }
  if (isRuntimeLocalAgentRef(agentId)) {
    const identity = parseRuntimeLocalAgentIdentity(agentId);
    if (identity.ownerUserId !== accountId) {
      throw new Error('avatar launch agentId does not match Runtime account projection');
    }
    return identity;
  }
  return projectRuntimeLocalAgentIdentity({
    ownerUserId: accountId,
    realmAgentId: agentId,
  });
}
