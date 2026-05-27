// SJ-SHELL-011 / spec K-ACCSVC-008: legacy shared desktop auth-session helpers
// (`loadAuthSession`, `saveAuthSession`, `clearAuthSession`) are NOT
// re-exported here. RuntimeAccountService owns token / refresh-token custody;
// ShiJi does not own a persisted auth-session bridge.
export {
  hasTauriInvoke,
  invoke,
  invokeChecked,
  BridgeError,
  getRuntimeDefaults,
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
} from '@nimiplatform/kit/shell/renderer/bridge';
export type {
  RuntimeDefaults,
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeBridgeDaemonStatus,
  JsonValue,
  JsonObject,
  JsonPrimitive,
} from '@nimiplatform/kit/shell/renderer/bridge';

import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';

export const shijiTauriOAuthBridge = createTauriOAuthBridge();
