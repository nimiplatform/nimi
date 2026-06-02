// Account app-library bridge.
//
// Renderer read seam for the Runtime-maintained account app-library
// projection. Runtime app lifecycle terminal handling owns writes; Desktop
// must not derive launch authority from renderer-observed job events.

import { parseOptionalAccountAppLibraryRecord, type AccountAppLibraryRecord } from '@nimiplatform/sdk/app';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

/** Read the account app-library projection, or `null` when not yet written. */
export async function getAccountAppLibrary(): Promise<AccountAppLibraryRecord | null> {
  if (!hasTauriInvoke()) {
    throw new Error('account_app_library_get requires the desktop Tauri runtime');
  }
  return invokeChecked('account_app_library_get', {}, parseOptionalAccountAppLibraryRecord);
}

/** The desktop account app-library bridge surface. */
export interface DesktopAppLibraryBridge {
  get(): Promise<AccountAppLibraryRecord | null>;
}

/** The default account app-library bridge bound to the Tauri commands. */
export const desktopAppLibraryBridge: DesktopAppLibraryBridge = {
  get: getAccountAppLibrary,
};
