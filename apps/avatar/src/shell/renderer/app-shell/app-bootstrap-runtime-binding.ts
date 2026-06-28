import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import {
  createNimiLocalFirstPartyRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  isRuntimeLocalAgentRef,
  parseRuntimeLocalAgentIdentity,
  projectRuntimeLocalAgentIdentity,
  type NimiRuntimeAppRegistrationClient,
  type NimiRuntimeAppSessionClient,
  type NimiRuntimeAppSessionMetadataProvider,
  type RuntimeOptions,
} from '@nimiplatform/sdk/runtime';
import { type AccountCaller } from '@nimiplatform/sdk/runtime/generated';
import { readNormalizedString } from './app-bootstrap-helpers.js';

const AVATAR_LOCAL_FIRST_PARTY_APP_INSTANCE_ID = 'nimi.avatar.local-first-party';
const AVATAR_LOCAL_FIRST_PARTY_DEVICE_ID = 'avatar-shell-runtime-bridge';

export type AvatarRuntimeHost = 'tauri' | 'electron';

export function createAvatarRuntimeTransport(
  host: AvatarRuntimeHost,
): NonNullable<RuntimeOptions['transport']> {
  if (host === 'electron') {
    return { type: 'electron-ipc' };
  }
  return {
    type: 'tauri-ipc',
    commandNamespace: 'runtime_bridge',
    eventNamespace: 'runtime_bridge',
  };
}

export function createAvatarRuntimeClient(input: {
  readonly appId: string;
  readonly host: AvatarRuntimeHost;
}): NimiClient {
  const appId = readNormalizedString(input.appId);
  if (!appId) {
    throw new Error('Avatar Runtime client requires appId');
  }
  return createNimiClient({
    appId,
    runtime: {
      appId,
      transport: createAvatarRuntimeTransport(input.host),
    },
  });
}

export function registerAvatarRuntimeApp(
  auth: NimiRuntimeAppRegistrationClient,
  appId: string,
): Promise<void> {
  return createNimiRuntimeFullAppRegistration(
    () => ({ auth }),
    {
      appId,
      appInstanceId: AVATAR_LOCAL_FIRST_PARTY_APP_INSTANCE_ID,
      deviceId: AVATAR_LOCAL_FIRST_PARTY_DEVICE_ID,
      rejectionLabel: 'Avatar Runtime app registration was rejected',
    },
  )();
}

export function createAvatarRuntimeAppSessionMetadataProvider(
  auth: NimiRuntimeAppRegistrationClient & NimiRuntimeAppSessionClient,
  appId: string,
): NimiRuntimeAppSessionMetadataProvider {
  return createNimiRuntimeAppSessionMetadataProvider({
    auth,
    appId,
    appInstanceId: AVATAR_LOCAL_FIRST_PARTY_APP_INSTANCE_ID,
    deviceId: AVATAR_LOCAL_FIRST_PARTY_DEVICE_ID,
    rejectionLabel: 'Avatar Runtime app session registration was rejected',
  });
}

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
  runtimeSourceRef: string;
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
    runtimeSourceRef: agentId,
  });
}
