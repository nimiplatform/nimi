import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { logRendererEvent, toRendererLogMessage } from '@renderer/bridge/runtime-bridge/logging';
import { proxyHttp } from '@renderer/bridge/runtime-bridge/http';
import {
  getRuntimeBridgeConfig as getDesktopRuntimeBridgeConfig,
  getRuntimeBridgeStatus as getDesktopRuntimeBridgeStatus,
  restartRuntimeBridge as restartDesktopRuntimeBridge,
  setRuntimeBridgeConfig as setDesktopRuntimeBridgeConfig,
  startRuntimeBridge as startDesktopRuntimeBridge,
  stopRuntimeBridge as stopDesktopRuntimeBridge,
} from '@renderer/bridge/runtime-bridge/runtime-daemon';
import { getSystemResourceSnapshot } from '@renderer/bridge/runtime-bridge/system-resources';
import { getRuntimeDefaults } from '@renderer/bridge/runtime-bridge/runtime-defaults';
import { oauthListenForCode, oauthTokenExchange } from '@renderer/bridge/runtime-bridge/oauth';
import { confirmPrivateSync, focusMainWindow, openExternalUrl, startWindowDrag } from '@renderer/bridge/runtime-bridge/ui';
import type {
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  RuntimeLocalManifestSummary,
  RuntimeModSourceType,
  RuntimeModSourceRecord,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticStatus,
  RuntimeModDiagnosticRecord,
  RuntimeModReloadResult,
  RuntimeModSourceChangeEvent,
  RuntimeModInstallPayload,
  RuntimeModInstallProgressEvent,
  RuntimeModInstallResult,
  RuntimeModUpdatePayload,
  SystemResourceSnapshot,
} from '@renderer/bridge/runtime-bridge/types';

export type {
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  RuntimeLocalManifestSummary,
  RuntimeModSourceType,
  RuntimeModSourceRecord,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticStatus,
  RuntimeModDiagnosticRecord,
  RuntimeModReloadResult,
  RuntimeModSourceChangeEvent,
  RuntimeModInstallPayload,
  RuntimeModInstallProgressEvent,
  RuntimeModInstallResult,
  RuntimeModUpdatePayload,
  SystemResourceSnapshot,
};

export { logRendererEvent, toRendererLogMessage };

export async function listRuntimeLocalModManifests(): Promise<RuntimeLocalManifestSummary[]> {
  return [];
}

export async function readRuntimeLocalModEntry(_path: string): Promise<string> {
  throw new Error('Local mod entry is only available in desktop runtime');
}

export async function listInstalledRuntimeMods(): Promise<RuntimeLocalManifestSummary[]> {
  return [];
}

export async function listRuntimeModSources(): Promise<RuntimeModSourceRecord[]> {
  return [];
}

export async function upsertRuntimeModSource(_input: {
  sourceId?: string;
  sourceType: 'installed' | 'dev';
  sourceDir: string;
  enabled?: boolean;
}): Promise<RuntimeModSourceRecord> {
  throw new Error('Runtime mod sources are only available in desktop runtime');
}

export async function removeRuntimeModSource(_sourceId: string): Promise<boolean> {
  throw new Error('Runtime mod sources are only available in desktop runtime');
}

export async function getRuntimeModDeveloperMode(): Promise<RuntimeModDeveloperModeState> {
  return { enabled: false, autoReloadEnabled: false };
}

export async function setRuntimeModDeveloperMode(_input: {
  enabled: boolean;
  autoReloadEnabled?: boolean;
}): Promise<RuntimeModDeveloperModeState> {
  throw new Error('Runtime mod developer mode is only available in desktop runtime');
}

export async function listRuntimeModDiagnostics(): Promise<RuntimeModDiagnosticRecord[]> {
  return [];
}

export async function reloadRuntimeMod(_modId: string): Promise<RuntimeModReloadResult[]> {
  return [];
}

export async function reloadAllRuntimeMods(): Promise<RuntimeModReloadResult[]> {
  return [];
}

export async function installRuntimeMod(_payload: RuntimeModInstallPayload): Promise<RuntimeModInstallResult> {
  throw new Error('Runtime mod install is only available in desktop runtime');
}

export async function updateRuntimeMod(_payload: RuntimeModUpdatePayload): Promise<RuntimeModInstallResult> {
  throw new Error('Runtime mod update is only available in desktop runtime');
}

export async function uninstallRuntimeMod(_modId: string): Promise<RuntimeLocalManifestSummary> {
  throw new Error('Runtime mod uninstall is only available in desktop runtime');
}

export async function readInstalledRuntimeModManifest(_input: {
  modId?: string;
  path?: string;
}): Promise<RuntimeLocalManifestSummary> {
  throw new Error('Runtime mod manifest read is only available in desktop runtime');
}

export async function listRuntimeModInstallProgress(
  _installSessionId?: string,
): Promise<RuntimeModInstallProgressEvent[]> {
  return [];
}

export async function subscribeRuntimeModInstallProgress(
  _listener: (event: RuntimeModInstallProgressEvent) => void,
): Promise<() => void> {
  return () => {};
}

export async function subscribeRuntimeModSourceChanged(
  _listener: (event: RuntimeModSourceChangeEvent) => void,
): Promise<() => void> {
  return () => {};
}

export async function subscribeRuntimeModReloadResult(
  _listener: (event: RuntimeModReloadResult) => void,
): Promise<() => void> {
  return () => {};
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return getDesktopRuntimeBridgeStatus();
}

export async function getRuntimeBridgeConfig(): Promise<RuntimeBridgeConfigGetResult> {
  return getDesktopRuntimeBridgeConfig();
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return startDesktopRuntimeBridge();
}

export async function stopRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return stopDesktopRuntimeBridge();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return restartDesktopRuntimeBridge();
}

export async function setRuntimeBridgeConfig(configJson: string): Promise<RuntimeBridgeConfigSetResult> {
  return setDesktopRuntimeBridgeConfig(configJson);
}

export const desktopBridge = {
  hasTauriInvoke,
  getRuntimeBridgeStatus,
  getRuntimeBridgeConfig,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  stopRuntimeBridge,
  restartRuntimeBridge,
  setRuntimeBridgeConfig,
  getRuntimeDefaults,
  proxyHttp,
  openExternalUrl,
  oauthTokenExchange,
  oauthListenForCode,
  confirmPrivateSync,
  focusMainWindow,
  listInstalledRuntimeMods,
  installRuntimeMod,
  listRuntimeLocalModManifests,
  listRuntimeModSources,
  upsertRuntimeModSource,
  removeRuntimeModSource,
  getRuntimeModDeveloperMode,
  setRuntimeModDeveloperMode,
  listRuntimeModDiagnostics,
  reloadRuntimeMod,
  reloadAllRuntimeMods,
  listRuntimeModInstallProgress,
  readInstalledRuntimeModManifest,
  readRuntimeLocalModEntry,
  subscribeRuntimeModInstallProgress,
  subscribeRuntimeModSourceChanged,
  subscribeRuntimeModReloadResult,
  startWindowDrag,
  uninstallRuntimeMod,
  updateRuntimeMod,
  logRendererEvent,
};
