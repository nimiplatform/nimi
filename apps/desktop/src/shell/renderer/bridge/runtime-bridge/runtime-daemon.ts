import { NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS } from '@nimiplatform/sdk/runtime';
import {
  getDaemonStatus,
  hasShellHostInvoke,
  hasTauriInvoke,
  restartDaemon,
  startDaemon,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  RuntimeBridgeDaemonStatus,
} from './types';

function unavailableStatus(lastError: string): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'INVALID',
    grpcAddr: NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr,
    lastError,
  };
}

function runtimeStatusUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.code === 'external-daemon-required'
    || record.code === 'capability-unavailable'
    || record.reasonCode === 'electron-runtime-endpoint-unavailable';
}

function runtimeStatusUnavailableMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'STANDARD_SHELL_RUNTIME_UNAVAILABLE';
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasShellHostInvoke()) {
    return unavailableStatus('STANDARD_SHELL_HOST_UNAVAILABLE');
  }
  try {
    return await getDaemonStatus();
  } catch (error) {
    if (!hasTauriInvoke() && runtimeStatusUnavailableError(error)) {
      return unavailableStatus(runtimeStatusUnavailableMessage(error));
    }
    throw error;
  }
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_start requires Tauri runtime');
  }
  return startDaemon();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_restart requires Tauri runtime');
  }
  return restartDaemon();
}
