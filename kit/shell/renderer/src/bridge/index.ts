export {
  convertTauriFileSrc,
  hasElectronRuntime,
  hasNimiShellRuntime,
  hasTauriRuntime,
  invokeShell,
  invokeTauri,
  listenShell,
  listenTauri,
} from './tauri-api.js';
export type { NimiShellRuntimeBridgeResult } from './tauri-api.js';
export { installNimiShellRuntimeBridge } from '../bootstrap/runtime-bridge.js';
export { hasElectronInvoke, hasShellHostInvoke, hasTauriInvoke } from './env.js';
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
  getDaemonStatus,
  startDaemon,
  restartDaemon,
  getDaemonConfig,
  setDaemonConfig,
} from './runtime-daemon.js';
export {
  oauthTokenExchange,
  oauthListenForCode,
  createStandardShellOAuthCodeBridge,
  createStandardShellOAuthBridge,
} from './oauth.js';
export {
  normalizeShellExternalUrl,
  openExternalUrl,
  confirmDialog,
  startWindowDrag,
  focusMainWindow,
} from './ui.js';
export {
  openShellFileDialog,
  revealShellFile,
  exportShellSaveFile,
  writeShellArtifact,
} from './files.js';
export type {
  ShellFileDialogFilter,
  ShellFileDialogOpenPayload,
  ShellFileDialogOpenResult,
  ShellFileRevealResult,
  ShellExportSaveFilePayload,
  ShellExportSaveFileResult,
  ShellArtifactWritePayload,
  ShellArtifactWriteResult,
} from './files.js';
export {
  floatingWindowSetBounds,
  floatingWindowSetIgnoreCursorEvents,
  floatingWindowSetAlwaysOnTop,
  floatingWindowHide,
  floatingWindowClose,
  floatingWindowBeginManualDrag,
  floatingWindowMoveManualDrag,
  floatingWindowConstrainToVisibleArea,
} from './floating-window.js';
export type {
  FloatingWindowBounds,
  FloatingWindowIgnoreCursorEventsOptions,
  FloatingWindowManualDragOrigin,
  FloatingWindowMoveDelta,
  FloatingWindowConstrainResult,
} from './floating-window.js';
export {
  createInstalledNimiAppStandardShellSurface,
  readInstalledNimiAppLaunchBinding,
} from './installed-app.js';
export {
  openDesktopIntent,
} from './desktop-open.js';
export {
  getShellPlatformProjection,
} from './platform-projection.js';
export {
  clearAgentCenterRegisteredDialogPathsForTest,
  createAgentCenterShellBridge,
  getAgentCenterBackground,
  importAgentCenterAvatarAsset,
  importAgentCenterBackground,
  importAgentCenterLive2dAdapter,
  pickAgentCenterBackgroundImage,
  pickAgentCenterLive2dAdapterJson,
  pickAgentCenterLive2dFolder,
  pickAgentCenterVrmFile,
  removeAgentCenterAccountResources,
  removeAgentCenterAgentResources,
  removeAgentCenterBackground,
  resolveAgentCenterAvatarAssetPreview,
  validateAgentCenterAvatarAsset,
  validateAgentCenterBackground,
} from './agent-center.js';
export type {
  NimiDesktopOpenRendererRequest,
  NimiDesktopOpenResult,
} from './desktop-open.js';
export type {
  ShellPlatformProjectionPayload,
  ShellPlatformProjectionResult,
} from './platform-projection.js';
export type {
  AgentCenterAvatarAssetImportPayload,
  AgentCenterAvatarAssetImportResult,
  AgentCenterAvatarAssetValidatePayload,
  AgentCenterAvatarAssetValidateResult,
  AgentCenterAvatarPreviewResolvePayload,
  AgentCenterAvatarPreviewResolveResult,
  AgentCenterBackgroundGetPayload,
  AgentCenterBackgroundGetResult,
  AgentCenterBackgroundImportPayload,
  AgentCenterBackgroundImportResult,
  AgentCenterBackgroundRemovePayload,
  AgentCenterBackgroundValidatePayload,
  AgentCenterBackgroundValidateResult,
  AgentCenterLive2dAdapterImportPayload,
  AgentCenterLive2dAdapterImportResult,
  AgentCenterResourceRemovalPayload,
  AgentCenterResourceRemovalResult,
  AgentCenterShellBridge,
  AgentCenterShellHostScope,
} from './agent-center.js';
export type {
  InstalledNimiAppStorageRemoveJsonResult,
  InstalledNimiAppStandardShellSurface,
  InstalledNimiAppLaunchBinding,
} from './installed-app.js';
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
