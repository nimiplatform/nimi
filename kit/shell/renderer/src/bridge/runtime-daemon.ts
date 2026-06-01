import { hasTauriInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import {
  parseRuntimeBridgeConfigGetResult,
  parseRuntimeBridgeConfigSetResult,
  parseRuntimeBridgeDaemonStatus,
  type RuntimeBridgeConfigGetResult,
  type RuntimeBridgeConfigSetResult,
  type RuntimeBridgeDaemonStatus,
} from './types.js';

const OFFLINE_STATUS: RuntimeBridgeDaemonStatus = {
  running: false,
  managed: false,
  launchMode: 'INVALID',
  grpcAddr: '',
};

export async function getDaemonStatus(): Promise<RuntimeBridgeDaemonStatus> {
  if (!hasTauriInvoke()) {
    return OFFLINE_STATUS;
  }
  return invokeChecked('runtime_bridge_status', {}, parseRuntimeBridgeDaemonStatus);
}

export async function startDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked('runtime_bridge_start', {}, parseRuntimeBridgeDaemonStatus);
}

export async function stopDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked('runtime_bridge_stop', {}, parseRuntimeBridgeDaemonStatus);
}

export async function restartDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked('runtime_bridge_restart', {}, parseRuntimeBridgeDaemonStatus);
}

export async function getDaemonConfig(): Promise<RuntimeBridgeConfigGetResult> {
  return invokeChecked('runtime_bridge_config_get', {}, parseRuntimeBridgeConfigGetResult);
}

export async function setDaemonConfig(configJson: string): Promise<RuntimeBridgeConfigSetResult> {
  return invokeChecked(
    'runtime_bridge_config_set',
    { payload: { configJson } },
    parseRuntimeBridgeConfigSetResult,
  );
}
