import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { RemoteRuntimeConnection } from '@nimiplatform/sdk/runtime/remote';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { observeLabLocalAppSessionLoss } from './auth/session-loss.js';
import { t } from './i18n/index.js';

let labLocalAppClient: NimiLocalAppClient | null = null;
export type LabRemoteAppClient = Extract<RemoteRuntimeConnection, { role: 'app' }>;
export type LabRuntimeClient = NimiLocalAppClient | LabRemoteAppClient;
let remoteCarrier = false;
let remoteClient: LabRemoteAppClient | null = null;

/** The Web entry chooses this carrier before mounting shared Lab surfaces.
 * Disconnecting never falls back to the native Host or another identity. */
export function setLabRemoteRuntime(client: LabRemoteAppClient | null): void {
  remoteCarrier = true;
  remoteClient = client;
}
export function isLabRemoteRuntime(): boolean { return remoteCarrier; }
export function getLabRemoteRuntime(): LabRemoteAppClient | null { return remoteClient; }
export function requireLabNativeClient(client: LabRuntimeClient): NimiLocalAppClient {
  if ('role' in client) throw new Error(t('Auth.web.nativeOperation'));
  return client;
}

/**
 * Shared Lab business entry. Native uses its Host-injected SDK client; Web
 * installs only the current direct App connection. SDK/Runtime own admission
 * and projection validation; neither path manufactures native identity.
 */
export function getLabLocalAppClient(): LabRuntimeClient {
  if (remoteCarrier) {
    if (!remoteClient || remoteClient.closed) throw new Error(t('Auth.web.disconnected'));
    return remoteClient;
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
