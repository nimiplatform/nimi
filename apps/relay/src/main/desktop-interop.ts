// RL-IPC-013 — Desktop Interop IPC
// RL-INTOP-004 — Desktop Config Deep-Link

import { ipcMain, shell } from 'electron';
import type { RelayInvokeMap } from '../shared/ipc-contract.js';

const DESKTOP_SCHEME = 'nimi-desktop';
const RUNTIME_CONFIG_PATH = 'runtime-config';
const ALLOWED_RUNTIME_CONFIG_PAGE_IDS = new Set([
  'overview',
  'recommend',
  'local',
  'cloud',
  'catalog',
  'runtime',
  'mods',
  'data-management',
  'performance',
  'mod-developer',
]);

type OpenConfigRequest = RelayInvokeMap['relay:desktop:open-config']['request'];
type OpenConfigResponse = RelayInvokeMap['relay:desktop:open-config']['response'];

export function registerDesktopInteropHandlers(): void {
  ipcMain.handle('relay:desktop:open-config', async (_e, input?: OpenConfigRequest): Promise<OpenConfigResponse> => {
    const requestedPageId = String(input?.pageId || '').trim();
    const pageId = ALLOWED_RUNTIME_CONFIG_PAGE_IDS.has(requestedPageId) ? requestedPageId : 'overview';
    const url = `${DESKTOP_SCHEME}://${RUNTIME_CONFIG_PATH}/${encodeURIComponent(pageId)}`;
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      console.error('[relay:interop] open-config failed', err);
      return { success: false };
    }
  });
}
