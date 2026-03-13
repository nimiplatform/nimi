import { hasTauriInvoke } from './env.js';
import { invoke } from './invoke.js';
import type { RuntimeBridgeDaemonStatus } from './types.js';

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
  return (await invoke('runtime_bridge_status')) as RuntimeBridgeDaemonStatus;
}

export async function startDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return (await invoke('runtime_bridge_start')) as RuntimeBridgeDaemonStatus;
}

export async function stopDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return (await invoke('runtime_bridge_stop')) as RuntimeBridgeDaemonStatus;
}

export async function restartDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return (await invoke('runtime_bridge_restart')) as RuntimeBridgeDaemonStatus;
}
