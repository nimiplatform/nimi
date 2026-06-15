import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from '@renderer/bridge/runtime-bridge/invoke';

function parseOptionalPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  return path || null;
}

export async function pickLocalAppRootDirectory(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('apps_pick_local_app_root_directory', {}, parseOptionalPath);
}
