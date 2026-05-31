/**
 * Editable account profile library — Tauri bridge surface.
 *
 * Spec authority: `P-AIPS-013` Account Default Profile Local Library Evidence.
 *
 * These functions are the renderer's bridge to the `account_profile_library_*`
 * Tauri commands. The account profile library file family
 * (`~/.nimi/accounts/<account-id>/profiles/{ index.json, user/, imported/ }`,
 * `account_profile_library_files.rs`) is the single source of truth; this
 * bridge only reads/writes it and parses the host projection fail-closed.
 */

import {
  parseAccountProfileLibraryProjection,
  parseExportedAccountProfileLibraryProfiles,
  type AccountProfileLibraryProjection,
  type AccountProfileLibraryIndexEntry,
  type AccountProfileLibraryOrigin,
  type AccountProfileLibraryProfile,
  type AIProfile,
} from '@nimiplatform/sdk/ai';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

export type LibraryProfileOrigin = AccountProfileLibraryOrigin;
export type LibraryProfile = AccountProfileLibraryProfile;
export type LibraryIndexEntry = AccountProfileLibraryIndexEntry;
export type { AccountProfileLibraryProjection } from '@nimiplatform/sdk/ai';

function requireTauri(command: string): void {
  if (!hasTauriInvoke()) {
    throw new Error(`${command} requires the desktop Tauri runtime`);
  }
}

// ---------------------------------------------------------------------------
// Tauri bridge commands
// ---------------------------------------------------------------------------

/** List the account profile library from the Rust file family. */
export async function listAccountProfileLibrary(): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_list');
  return invokeChecked('account_profile_library_list', {}, parseAccountProfileLibraryProjection);
}

/** Create a new user-authored library profile under `user/`. */
export async function createAccountProfileLibraryProfile(
  profile: AIProfile,
): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_create');
  return invokeChecked(
    'account_profile_library_create',
    { payload: { profile } },
    parseAccountProfileLibraryProjection,
  );
}

/** Edit an existing editable library profile in place. */
export async function editAccountProfileLibraryProfile(
  profile: AIProfile,
): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_edit');
  return invokeChecked(
    'account_profile_library_edit',
    { payload: { profile } },
    parseAccountProfileLibraryProjection,
  );
}

/** Import one or more profiles into the library `imported/` directory. */
export async function importAccountProfileLibraryProfiles(
  profiles: AIProfile[],
): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_import');
  return invokeChecked(
    'account_profile_library_import',
    { payload: { profiles } },
    parseAccountProfileLibraryProjection,
  );
}

/**
 * Export editable library profiles as portable AIProfile payloads.
 * An empty `profileIds` exports every editable library profile.
 */
export async function exportAccountProfileLibraryProfiles(
  profileIds: string[] = [],
): Promise<AIProfile[]> {
  requireTauri('account_profile_library_export');
  return invokeChecked(
    'account_profile_library_export',
    { payload: { profileIds } },
    parseExportedAccountProfileLibraryProfiles,
  );
}

/** Delete an editable library profile. */
export async function deleteAccountProfileLibraryProfile(
  profileId: string,
): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_delete');
  return invokeChecked(
    'account_profile_library_delete',
    { payload: { profileId } },
    parseAccountProfileLibraryProjection,
  );
}
