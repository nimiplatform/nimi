/**
 * Editable account profile library host bridge.
 *
 * The account profile library under the Runtime-authenticated account and
 * Product-Control-ready data root is the single source of truth. The renderer
 * only invokes the Desktop host and parses its projection fail-closed.
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
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

export type LibraryProfileOrigin = NimiAccountProfileLibraryOrigin;
export type LibraryProfile = NimiAccountProfileLibraryProfile;
export type LibraryIndexEntry = NimiAccountProfileLibraryIndexEntry;

function requireDesktopHost(command: string): void {
  if (!hasElectronInvoke()) {
    throw new Error(`${command} requires the Desktop host runtime`);
  }
}

/** List the account profile library from the Rust file family. */
export async function listAccountProfileLibrary(): Promise<NimiAccountProfileLibraryProjection> {
  requireDesktopHost('account_profile_library_list');
  return invokeChecked('account_profile_library_list', {}, parseNimiAccountProfileLibraryProjection);
}

/** Create a new user-authored library profile under `user/`. */
export async function createAccountProfileLibraryProfile(
  profile: NimiAIProfile,
): Promise<NimiAccountProfileLibraryProjection> {
  requireDesktopHost('account_profile_library_create');
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
  requireDesktopHost('account_profile_library_edit');
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
  requireDesktopHost('account_profile_library_import');
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
  requireDesktopHost('account_profile_library_export');
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
  requireDesktopHost('account_profile_library_delete');
  return invokeChecked(
    'account_profile_library_delete',
    { payload: { profileId } },
    parseNimiAccountProfileLibraryProjection,
  );
}
