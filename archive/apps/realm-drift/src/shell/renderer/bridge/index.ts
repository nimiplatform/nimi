// RD-SHELL-010 / spec K-ACCSVC-008: legacy shared desktop auth-session helpers
// (`loadAuthSession`, `saveAuthSession`, `clearAuthSession`) are NOT
// re-exported here. RuntimeAccountService owns token / refresh-token custody;
// Realm Drift does not own a persisted auth-session bridge.
export {
  hasTauriInvoke,
  invoke,
  invokeChecked,
  BridgeError,
  getRuntimeDefaults,
  getDaemonStatus,
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

// RD-SHELL-009 / RD-SHELL-010: Tauri OAuth bridge for the kit
// `<DesktopShellAuthPage>` desktop-browser flow. Runtime BeginLogin returns a
// realm OAuth authorize URL; the bridge opens the system browser, listens for
// the loopback callback `code`, and the runtime broker exchanges it.
export const driftTauriOAuthBridge = createTauriOAuthBridge();
