import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import {
  createNimiLocalFirstPartyRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  isRuntimeLocalAgentRef,
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
  ownerUserId?: string | null;
  localAgentRef?: string | null;
  runtimeSourceRef?: string | null;
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
  const launchOwnerUserId = readNormalizedString(input.ownerUserId);
  if (launchOwnerUserId && launchOwnerUserId !== accountId) {
    throw new Error('avatar launch context ownerUserId does not match Runtime account projection');
  }
  const localAgentRef = readNormalizedString(input.localAgentRef);
  const runtimeSourceRef = readNormalizedString(input.runtimeSourceRef);
  if (!localAgentRef || !runtimeSourceRef) {
    throw new Error('avatar launch context requires explicit localAgentRef and runtimeSourceRef');
  }
  if (agentId !== localAgentRef) {
    throw new Error('avatar launch context requires agentId to equal localAgentRef');
  }
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    throw new Error('avatar launch context localAgentRef is malformed');
  }
  return projectRuntimeLocalAgentIdentity({
    ownerUserId: accountId,
    runtimeSourceRef,
    localAgentRef,
  });
}
