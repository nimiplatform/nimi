import {
  AccountCallerMode,
  type AccountCaller,
} from '@nimiplatform/sdk/runtime/browser';
import { readNormalizedString } from './app-bootstrap-helpers.js';

const AVATAR_FIRST_PARTY_APP_INSTANCE_ID = 'nimi.avatar.local-first-party';
const AVATAR_FIRST_PARTY_DEVICE_ID = 'local-first-party-device';
const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

export function createAvatarAccountCaller(appId: string): AccountCaller {
  return {
    appId,
    appInstanceId: AVATAR_FIRST_PARTY_APP_INSTANCE_ID,
    deviceId: AVATAR_FIRST_PARTY_DEVICE_ID,
    mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    scopes: [],
  };
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
  const ownerUserId = accountId;
  if (agentId.startsWith(LOCAL_AGENT_REF_PREFIX)) {
    const rest = agentId.slice(LOCAL_AGENT_REF_PREFIX.length);
    const separatorIndex = rest.indexOf(':');
    const selectedOwnerUserId = separatorIndex >= 0 ? rest.slice(0, separatorIndex).trim() : '';
    const selectedRealmAgentId = separatorIndex >= 0 ? rest.slice(separatorIndex + 1).trim() : '';
    if (!selectedOwnerUserId || !selectedRealmAgentId) {
      throw new Error('avatar launch agentId local-agent selector is malformed');
    }
    if (selectedOwnerUserId !== ownerUserId) {
      throw new Error('avatar launch agentId does not match Runtime account projection');
    }
    return {
      ownerUserId,
      realmAgentId: selectedRealmAgentId,
      localAgentRef: agentId,
    };
  }
  const realmAgentId = agentId;
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef: `${LOCAL_AGENT_REF_PREFIX}${ownerUserId}:${realmAgentId}`,
  };
}
