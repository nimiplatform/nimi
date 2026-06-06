import { NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS } from '@nimiplatform/sdk/runtime';
import {
  getDaemonConfig,
  getDaemonStatus,
  hasTauriInvoke,
  restartDaemon,
  setDaemonConfig,
  startDaemon,
  stopDaemon,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
} from './types';

function tauriUnavailableStatus(): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'INVALID',
    grpcAddr: NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr,
    lastError: 'TAURI_RUNTIME_UNAVAILABLE',
  };
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    return tauriUnavailableStatus();
  }
  return getDaemonStatus();
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_start requires Tauri runtime');
  }
  return startDaemon();
}

export async function stopRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_stop requires Tauri runtime');
  }
  return stopDaemon();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_restart requires Tauri runtime');
  }
  return restartDaemon();
}

export async function getRuntimeBridgeConfig(): Promise<RuntimeBridgeConfigGetResult> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_config_get requires Tauri runtime');
  }
  return getDaemonConfig();
}

export async function setRuntimeBridgeConfig(configJson: string): Promise<RuntimeBridgeConfigSetResult> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_config_set requires Tauri runtime');
  }
  return setDaemonConfig(configJson);
}
