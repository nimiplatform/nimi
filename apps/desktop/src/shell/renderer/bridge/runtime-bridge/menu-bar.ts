import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';

import {
  MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
  parseMenuBarRuntimeHealthSyncResult,
  type MenuBarRuntimeHealthSyncPayload,
} from '../../../shared/menu-bar-types.js';
import { invokeChecked } from './invoke.js';

export async function syncMenuBarRuntimeHealth(
  payload: MenuBarRuntimeHealthSyncPayload,
): Promise<void> {
  if (!hasElectronInvoke()) {
    throw new Error('menu-bar-runtime-health-sync-requires-electron-host');
  }
  await invokeChecked(
    MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
    { payload },
    parseMenuBarRuntimeHealthSyncResult,
  );
}

export type {
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
} from '../../../shared/menu-bar-types.js';
