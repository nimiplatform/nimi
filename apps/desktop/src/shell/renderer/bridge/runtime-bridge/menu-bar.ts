import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import type { MenuBarRuntimeHealthSyncPayload } from './types';

export async function syncMenuBarRuntimeHealth(payload: MenuBarRuntimeHealthSyncPayload): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeChecked('menu_bar_sync_runtime_health', { payload }, () => undefined);
}

export async function completeMenuBarQuit(): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeChecked('menu_bar_complete_quit', {}, () => undefined);
}
