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
export {
  extractShellBridgeErrorCode,
  getShellBridgeUserMessageProjection,
  parseShellBridgeJsonPayload,
  toShellBridgeNimiError,
  toShellBridgeUserMessage,
} from './nimi-error.js';
export type {
  ShellBridgeNimiErrorOptions,
  ShellBridgeStructuredError,
  ShellBridgeUserMessageProjection,
} from './nimi-error.js';
export { getRuntimeDefaults } from './runtime-defaults.js';
export {
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
  watchAuthSessionChanges,
} from './auth-session.js';
export {
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  getDaemonConfig,
  setDaemonConfig,
} from './runtime-daemon.js';
export {
  oauthTokenExchange,
  oauthListenForCode,
  createTauriOAuthCodeBridge,
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
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
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
  parseRuntimeBridgeConfigGetResult,
  parseRuntimeBridgeConfigSetResult,
  parseConfirmDialogResult,
} from './types.js';
