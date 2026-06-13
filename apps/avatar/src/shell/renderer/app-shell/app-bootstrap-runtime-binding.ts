import { createNimiLocalFirstPartyRuntimeAccountCaller, isRuntimeLocalAgentRef, parseRuntimeLocalAgentIdentity, projectRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';
import { type AccountCaller } from '@nimiplatform/sdk/runtime/generated';
import { readNormalizedString } from './app-bootstrap-helpers.js';

const AVATAR_LOCAL_FIRST_PARTY_APP_INSTANCE_ID = 'nimi.avatar.local-first-party';
const AVATAR_LOCAL_FIRST_PARTY_DEVICE_ID = 'avatar-shell-runtime-bridge';

export function createAvatarAccountCaller(appId: string): AccountCaller {
  return createNimiLocalFirstPartyRuntimeAccountCaller({
    appId,
    appInstanceId: AVATAR_LOCAL_FIRST_PARTY_APP_INSTANCE_ID,
    deviceId: AVATAR_LOCAL_FIRST_PARTY_DEVICE_ID,
  });
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
