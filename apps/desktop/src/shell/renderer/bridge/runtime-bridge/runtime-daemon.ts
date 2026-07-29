import {
  getDaemonStatus,
  hasElectronInvoke,
  restartDaemon,
  startDaemon,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  RuntimeBridgeDaemonStatus,
} from './types';

function requireElectronHost(action: string): void {
  if (!hasElectronInvoke()) {
    throw new Error(`runtime lifecycle ${action} requires the Electron standard shell host`);
  }
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  requireElectronHost('status');
  return getDaemonStatus();
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  requireElectronHost('start');
  return startDaemon();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  requireElectronHost('restart');
  return restartDaemon();
}
