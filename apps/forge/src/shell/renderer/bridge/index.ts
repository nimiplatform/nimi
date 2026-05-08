export {
  hasTauriInvoke,
  invoke,
  invokeChecked,
  BridgeError,
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  createTauriOAuthBridge,
  oauthTokenExchange,
  oauthListenForCode,
  openExternalUrl,
  focusMainWindow,
  parseRuntimeDefaults,
  parseRuntimeBridgeDaemonStatus,
  hasTauriRuntime,
  invokeTauri,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';
export type {
  RuntimeDefaults,
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeBridgeDaemonStatus,
  JsonValue,
  JsonObject,
  JsonPrimitive,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';

import {
  createTauriOAuthBridge,
  getRuntimeDefaults as getKitRuntimeDefaults,
  type RuntimeDefaults,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';
export const forgeTauriOAuthBridge = createTauriOAuthBridge();

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  const defaults = await getKitRuntimeDefaults();
  return {
    ...defaults,
    realm: {
      ...defaults.realm,
      accessToken: '',
    },
  };
}
