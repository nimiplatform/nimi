// Account app-library bridge (T4-W4 Fork D).
//
// Renderer seam onto the `account_app_library_*` Tauri commands. The desktop
// Tauri layer owns the `library.json` writer (Fork D / D1); this module is the
// renderer's typed call surface for it.
//
// The Apps controller calls `applyLibraryMutation` when it observes a terminal
// `RuntimeAppInstallJob` frame — an `installed` install/update job marks the
// app installed+enabled; an `uninstalled` job marks the package not-installed
// while keeping the account library record (manual `#### Uninstall And Data`);
// a confirmed destructive "Delete app data" removes the library record.
//
// Fails closed: a malformed payload or a non-desktop host throws rather than
// projecting a partial library record as success.

import {
  parseAccountAppLibraryRecord,
  parseOptionalAccountAppLibraryRecord,
  type AccountAppLibraryRecord,
} from '@nimiplatform/sdk/app';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

export type { AccountAppLibraryRecord } from '@nimiplatform/sdk/app';

/** The lifecycle-terminal mutation the renderer requests. */
export type AccountAppLibraryMutationKind =
  | 'installed_enabled'
  | 'uninstalled_keep_record'
  | 'removed_from_library';

/** Read the account app-library projection, or `null` when not yet written. */
export async function getAccountAppLibrary(): Promise<AccountAppLibraryRecord | null> {
  if (!hasTauriInvoke()) {
    throw new Error('account_app_library_get requires the desktop Tauri runtime');
  }
  return invokeChecked('account_app_library_get', {}, parseOptionalAccountAppLibraryRecord);
}

/**
 * Apply an install / uninstall / remove mutation to one app's library row.
 * Returns the committed record. The Tauri command fails closed on a faulted
 * existing file.
 */
export async function applyLibraryMutation(input: {
  appId: string;
  mutation: AccountAppLibraryMutationKind;
}): Promise<AccountAppLibraryRecord> {
  if (!hasTauriInvoke()) {
    throw new Error('account_app_library_apply requires the desktop Tauri runtime');
  }
  const appId = input.appId.trim();
  if (!appId) {
    throw new Error('account_app_library_apply requires a non-empty appId');
  }
  return invokeChecked(
    'account_app_library_apply',
    { payload: { appId, mutation: input.mutation } },
    parseAccountAppLibraryRecord,
  );
}

/** The desktop account app-library bridge surface. */
export interface DesktopAppLibraryBridge {
  get(): Promise<AccountAppLibraryRecord | null>;
  apply(input: {
    appId: string;
    mutation: AccountAppLibraryMutationKind;
  }): Promise<AccountAppLibraryRecord>;
}

/** The default account app-library bridge bound to the Tauri commands. */
export const desktopAppLibraryBridge: DesktopAppLibraryBridge = {
  get: getAccountAppLibrary,
  apply: applyLibraryMutation,
};
