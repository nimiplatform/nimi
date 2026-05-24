// PO-SHELL-008 / spec K-ACCSVC-008: ParentOS does not own access/refresh
// token custody. The legacy `auth_session_load`/`save`/`clear` Tauri commands
// were already disabled at the host layer; the kit also no longer re-exports
// them through the parentos bridge.
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
export const parentosTauriOAuthBridge = createTauriOAuthBridge();

export type { ParentOSRuntimeDefaults } from './parentos-types.js';
export { getParentOSRuntimeDefaults } from './parentos-runtime-defaults.js';
