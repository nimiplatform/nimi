import { hasTauriRuntime } from './tauri-api.js';
import { invokeChecked } from './invoke.js';
import {
  parseRuntimeBridgeDaemonStatus,
  type RuntimeBridgeDaemonStatus,
} from './types.js';

function tauriUnavailableStatus(): RuntimeBridgeDaemonStatus {
  return {
    running: false,
    managed: false,
    launchMode: 'INVALID',
    grpcAddr: '127.0.0.1:46371',
    lastError: 'TAURI_RUNTIME_UNAVAILABLE',
  };
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriRuntime()) {
    return tauriUnavailableStatus();
  }
  return invokeChecked('runtime_bridge_status', {}, parseRuntimeBridgeDaemonStatus);
}
