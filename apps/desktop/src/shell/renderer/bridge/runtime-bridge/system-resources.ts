import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseSystemResourceSnapshot,
  type SystemResourceSnapshot,
} from './types';

function tauriUnavailableSnapshot(): SystemResourceSnapshot {
  return {
    cpuPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    temperatureCelsius: undefined,
    capturedAtMs: Date.now(),
    source: 'TAURI_RUNTIME_UNAVAILABLE',
  };
}

export async function getSystemResourceSnapshot(): Promise<SystemResourceSnapshot> {
  if (!hasTauriInvoke()) {
    return tauriUnavailableSnapshot();
  }
  return invokeChecked(
    'get_system_resource_snapshot',
    {},
    parseSystemResourceSnapshot,
  );
}
