export {
  convertTauriFileSrc,
  hasTauriRuntime,
  invokeTauri,
  listenTauri,
  installNimiShellRuntimeBridge,
} from './tauri-api.js';
export type { NimiShellRuntimeBridgeResult } from './tauri-api.js';
export { hasTauriInvoke } from './env.js';
export { invoke, invokeChecked, BridgeError } from './invoke.js';
export { getRuntimeDefaults } from './runtime-defaults.js';
export {
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
  watchAuthSessionChanges,
} from './auth-session.js';
export { getDaemonStatus, startDaemon, stopDaemon, restartDaemon } from './runtime-daemon.js';
export {
  oauthTokenExchange,
  oauthListenForCode,
  createTauriOAuthBridge,
} from './oauth.js';
export {
  normalizeShellExternalUrl,
  openExternalUrl,
  confirmDialog,
  startWindowDrag,
  focusMainWindow,
} from './ui.js';
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  RuntimeDefaults,
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeBridgeDaemonStatus,
  ConfirmDialogPayload,
  ConfirmDialogResult,
} from './types.js';
export type { SharedDesktopAuthSessionWatchOptions } from './auth-session.js';
export {
  assertRecord,
  isJsonObject,
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
  parseRuntimeDefaults,
  parseRuntimeBridgeDaemonStatus,
  parseConfirmDialogResult,
} from './types.js';
