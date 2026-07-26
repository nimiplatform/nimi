/**
 * Editable account profile library — Tauri bridge surface.
 *
 * Spec authority: `P-AIPS-013` Account Default Profile Local Library Evidence.
 *
 * These functions are the renderer's bridge to the `account_profile_library_*`
 * Tauri commands. The account profile library file family
 * (`<dataRoot>/accounts/<account-id>/profiles/{ index.json, user/, imported/ }`,
 * `account_profile_library_files.rs`) is the single source of truth; this
 * bridge only reads/writes it and parses the host projection fail-closed.
 */

import {
  parseNimiAccountProfileLibraryProjection,
  parseExportedNimiAccountProfileLibraryProfiles,
  type NimiAccountProfileLibraryProjection,
  type NimiAccountProfileLibraryIndexEntry,
  type NimiAccountProfileLibraryOrigin,
  type NimiAccountProfileLibraryProfile,
  type NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

export type LibraryProfileOrigin = NimiAccountProfileLibraryOrigin;
export type LibraryProfile = NimiAccountProfileLibraryProfile;
export type LibraryIndexEntry = NimiAccountProfileLibraryIndexEntry;

function requireTauri(command: string): void {
  if (!hasTauriInvoke()) {
    throw new Error(`${command} requires the desktop Tauri runtime`);
  }
}

// ---------------------------------------------------------------------------
// Tauri bridge commands
// ---------------------------------------------------------------------------

/** List the account profile library from the Rust file family. */
export async function listAccountProfileLibrary(): Promise<NimiAccountProfileLibraryProjection> {
  requireTauri('account_profile_library_list');
  return invokeChecked('account_profile_library_list', {}, parseNimiAccountProfileLibraryProjection);
}

/** Create a new user-authored library profile under `user/`. */
export async function createAccountProfileLibraryProfile(
  profile: NimiAIProfile,
): Promise<NimiAccountProfileLibraryProjection> {
  requireTauri('account_profile_library_create');
  return invokeChecked(
    'account_profile_library_create',
    { payload: { profile } },
    parseNimiAccountProfileLibraryProjection,
  );
}

/** Edit an existing editable library profile in place. */
export async function editAccountProfileLibraryProfile(
  profile: NimiAIProfile,
): Promise<NimiAccountProfileLibraryProjection> {
  requireTauri('account_profile_library_edit');
  return invokeChecked(
    'account_profile_library_edit',
    { payload: { profile } },
    parseNimiAccountProfileLibraryProjection,
  );
}

/** Import one or more profiles into the library `imported/` directory. */
export async function importAccountProfileLibraryProfiles(
  profiles: NimiAIProfile[],
): Promise<NimiAccountProfileLibraryProjection> {
  requireTauri('account_profile_library_import');
  return invokeChecked(
    'account_profile_library_import',
    { payload: { profiles } },
    parseNimiAccountProfileLibraryProjection,
  );
}

/**
 * Export editable library profiles as portable NimiAIProfile payloads.
 * An empty `profileIds` exports every editable library profile.
 */
export async function exportAccountProfileLibraryProfiles(
  profileIds: string[] = [],
): Promise<NimiAIProfile[]> {
  requireTauri('account_profile_library_export');
  const profiles = await invokeChecked(
    'account_profile_library_export',
    { payload: { profileIds } },
    parseExportedNimiAccountProfileLibraryProfiles,
  );
  return [...profiles];
}

/** Delete an editable library profile. */
export async function deleteAccountProfileLibraryProfile(
  profileId: string,
): Promise<NimiAccountProfileLibraryProjection> {
  requireTauri('account_profile_library_delete');
  return invokeChecked(
    'account_profile_library_delete',
    { payload: { profileId } },
    parseNimiAccountProfileLibraryProjection,
  );
}
