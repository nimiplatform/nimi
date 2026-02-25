import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseRuntimeBridgeDaemonStatus,
  type RuntimeBridgeDaemonStatus,
} from './types';

function tauriUnavailableStatus(): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    grpcAddr: '127.0.0.1:46371',
    lastError: 'TAURI_RUNTIME_UNAVAILABLE',
  };
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    return tauriUnavailableStatus();
  }
  return invokeChecked('runtime_bridge_status', {}, parseRuntimeBridgeDaemonStatus);
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_start requires Tauri runtime');
  }
  return invokeChecked('runtime_bridge_start', {}, parseRuntimeBridgeDaemonStatus);
}

export async function stopRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_stop requires Tauri runtime');
  }
  return invokeChecked('runtime_bridge_stop', {}, parseRuntimeBridgeDaemonStatus);
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_bridge_restart requires Tauri runtime');
  }
  return invokeChecked('runtime_bridge_restart', {}, parseRuntimeBridgeDaemonStatus);
}
