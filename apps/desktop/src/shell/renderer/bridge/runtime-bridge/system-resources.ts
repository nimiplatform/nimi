import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseSystemResourceSnapshot,
  type SystemResourceSnapshot,
} from './types';

export async function getSystemResourceSnapshot(): Promise<SystemResourceSnapshot> {
  if (!hasTauriInvoke()) {
    throw new Error('TAURI_RUNTIME_UNAVAILABLE');
  }
  return invokeChecked(
    'get_system_resource_snapshot',
    {},
    parseSystemResourceSnapshot,
  );
}
