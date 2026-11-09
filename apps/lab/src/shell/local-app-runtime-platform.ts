import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { NimiAppScope, NimiAppIdentity } from '@nimiplatform/kit/core/app-session';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { observeLabLocalAppSessionLoss } from './auth/session-loss.js';
import { t } from './i18n/index.js';

let labLocalAppClient: NimiLocalAppClient | null = null;
export type LabRemoteAppClient = NimiAppScope['client'];
export type LabRuntimeClient = NimiLocalAppClient | LabRemoteAppClient;
let remoteCarrier = false;
let remoteClient: (NimiAppScope & { user: NimiAppIdentity | null }) | null = null;

/** The Web entry chooses this carrier before mounting shared Lab surfaces.
 * Disconnecting never falls back to the native Host or another identity. */
export function setLabRemoteRuntime(client: (NimiAppScope & { user: NimiAppIdentity | null }) | null): void {
  remoteCarrier = true;
  remoteClient = client;
}
export function isLabRemoteRuntime(): boolean { return remoteCarrier; }
export function getLabRemoteRuntime(): typeof remoteClient { return remoteClient; }
export function requireLabNativeClient(client: LabRuntimeClient): NimiLocalAppClient {
  if (!('auth' in client)) throw new Error(t('Auth.web.nativeOperation'));
  return client;
}

/**
 * Shared Lab business entry. Native uses its Host-injected SDK client; Web
 * installs only the current direct App connection. SDK/Runtime own admission
 * and projection validation; neither path manufactures native identity.
 */
export function getLabLocalAppClient(): LabRuntimeClient {
  if (remoteCarrier) {
    if (!remoteClient || remoteClient.signal.aborted) throw new Error(t('Auth.web.disconnected'));
    return remoteClient.client;
  }
  return getLabNativeAppClient();
}

export function getLabNativeAppClient(): NimiLocalAppClient {
  if (remoteCarrier) throw new Error(t('Auth.web.nativeOperation'));
  labLocalAppClient ??= createNimiClient({
    localApp: { standardShell: observeLabLocalAppSessionLoss(createNimiLocalAppStandardShellSurface()) },
  });
  return labLocalAppClient;
}
