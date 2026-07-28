import { invokeChecked } from './invoke';
import {
  parseSystemResourceSnapshot,
  type SystemResourceSnapshot,
} from './types';

export async function getSystemResourceSnapshot(): Promise<SystemResourceSnapshot> {
  return invokeChecked(
    'get_system_resource_snapshot',
    {},
    parseSystemResourceSnapshot,
  );
}
