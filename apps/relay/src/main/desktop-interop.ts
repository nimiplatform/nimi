// RL-IPC-013 — Desktop Interop IPC
// RL-INTOP-004 — Desktop Config Deep-Link

import { ipcMain, shell } from 'electron';

const DESKTOP_SCHEME = 'nimi-desktop';
const RUNTIME_CONFIG_PATH = 'runtime-config';

export function registerDesktopInteropHandlers(): void {
  ipcMain.handle('relay:desktop:open-config', async (_e, input?: { pageId?: string }) => {
    const pageId = input?.pageId || 'overview';
    const url = `${DESKTOP_SCHEME}://${RUNTIME_CONFIG_PATH}/${encodeURIComponent(pageId)}`;
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch {
      return { success: false };
    }
  });
}
