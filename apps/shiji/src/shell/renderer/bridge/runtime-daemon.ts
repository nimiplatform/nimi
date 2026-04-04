import { invoke } from './invoke.js';

export type RuntimeBridgeDaemonStatus = {
  running: boolean;
  managed: boolean;
  launchMode: string;
  grpcAddr: string;
  pid?: number;
  lastError?: string;
  debugLogPath?: string;
};

export async function getDaemonStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return (await invoke('runtime_bridge_status')) as RuntimeBridgeDaemonStatus;
}

export async function startDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return (await invoke('runtime_bridge_start')) as RuntimeBridgeDaemonStatus;
}
