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
import { confirmPrivateSync, openExternalUrl, startWindowDrag } from '@renderer/bridge/runtime-bridge/ui';
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
  SystemResourceSnapshot,
};

export { logRendererEvent, toRendererLogMessage };

export async function listRuntimeLocalModManifests(): Promise<RuntimeLocalManifestSummary[]> {
  return [];
}

export async function readRuntimeLocalModEntry(_path: string): Promise<string> {
  throw new Error('Local mod entry is only available in desktop runtime');
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
  listRuntimeLocalModManifests,
  readRuntimeLocalModEntry,
  startWindowDrag,
  logRendererEvent,
};
