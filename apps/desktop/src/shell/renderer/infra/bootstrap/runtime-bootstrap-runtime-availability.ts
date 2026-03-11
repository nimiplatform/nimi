import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import { checkDaemonVersion } from './version-check';

export function isRuntimeDaemonReachable(status: Pick<RuntimeBridgeDaemonStatus, 'running' | 'version'>): boolean {
  if (!status.running) {
    return false;
  }
  return checkDaemonVersion(status.version).ok;
}
