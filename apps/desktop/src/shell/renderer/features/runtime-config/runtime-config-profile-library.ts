/**
 * Editable account profile library — renderer feature access layer.
 *
 * Spec authority: `P-AIPS-013` Account Default Profile Local Library Evidence.
 *
 * The account profile library file family
 * (`~/.nimi/accounts/<account-id>/profiles/{ index.json, user/, imported/ }`)
 * is owned by the Rust host (`account_profile_library_files.rs`) and is the
 * single source of truth. The Tauri bridge to it lives in
 * `@renderer/bridge/runtime-bridge/account-profile-library`; this feature
 * module is a thin wrapper that adds a synchronous read-through projection so
 * the kit's synchronous `userProfilesSource.list()` keeps working.
 *
 * P-AIPS-013 forbids renderer profile state / SDK cache / app-local cache as
 * profile-library truth. The module-level `libraryProjectionCache` here is NOT
 * a store and NOT truth: it is a read-through projection of the Rust file
 * family, populated only by a successful Rust read and replaced wholesale on
 * every mutation. Every create/edit/import/delete writes the Rust file family
 * first and adopts the Rust-returned projection; the renderer never authors a
 * profile record locally.
 *
 * Hard cut: this module replaces the retired `runtime-config-profile-storage`
 * localStorage store. There is no migration of prior localStorage profiles and
 * no compatibility bridge.
 */

import type {
  NimiAccountProfileLibraryIndexEntry,
  NimiAccountProfileLibraryOrigin,
  NimiAccountProfileLibraryProfile,
  NimiAccountProfileLibraryProjection,
  NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import { createNimiClientId } from '@nimiplatform/sdk';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createAccountProfileLibraryProfile,
  deleteAccountProfileLibraryProfile,
  editAccountProfileLibraryProfile,
  exportAccountProfileLibraryProfiles,
  importAccountProfileLibraryProfiles,
  listAccountProfileLibrary,
} from '../../bridge/runtime-bridge/account-profile-library.js';

export type LibraryProfileOrigin = NimiAccountProfileLibraryOrigin;
export type LibraryProfile = NimiAccountProfileLibraryProfile;
export type LibraryIndexEntry = NimiAccountProfileLibraryIndexEntry;
export type { NimiAccountProfileLibraryProjection };

// ---------------------------------------------------------------------------
// Read-through projection cache (a projection of Rust truth, never the store)
// ---------------------------------------------------------------------------

let libraryProjectionCache: NimiAccountProfileLibraryProjection | null = null;

function adoptProjection(
  projection: NimiAccountProfileLibraryProjection,
): NimiAccountProfileLibraryProjection {
  libraryProjectionCache = projection;
  return projection;
}

// ---------------------------------------------------------------------------
// Async library operations (the only write/read path to the file family)
// ---------------------------------------------------------------------------

/** Load the account profile library from the Rust file family. */
export async function loadAccountProfileLibrary(): Promise<NimiAccountProfileLibraryProjection> {
  return adoptProjection(await listAccountProfileLibrary());
}

/** Create a new user-authored library profile under `user/`. */
export async function createAccountProfileLibraryEntry(
  profile: NimiAIProfile,
): Promise<NimiAccountProfileLibraryProjection> {
  return adoptProjection(await createAccountProfileLibraryProfile(profile));
}

/** Edit an existing editable library profile in place. */
export async function editAccountProfileLibraryEntry(
  profile: NimiAIProfile,
): Promise<NimiAccountProfileLibraryProjection> {
  return adoptProjection(await editAccountProfileLibraryProfile(profile));
}

/** Import one or more profiles into the library `imported/` directory. */
export async function importAccountProfileLibraryEntries(
  profiles: NimiAIProfile[],
): Promise<NimiAccountProfileLibraryProjection> {
  return adoptProjection(await importAccountProfileLibraryProfiles(profiles));
}

/**
 * Export editable library profiles as portable NimiAIProfile payloads.
 * An empty `profileIds` exports every editable library profile.
 */
export async function exportAccountProfileLibraryEntries(
  profileIds: string[] = [],
): Promise<NimiAIProfile[]> {
  return exportAccountProfileLibraryProfiles(profileIds);
}

/** Delete an editable library profile. */
export async function deleteAccountProfileLibraryEntry(
  profileId: string,
): Promise<NimiAccountProfileLibraryProjection> {
  return adoptProjection(await deleteAccountProfileLibraryProfile(profileId));
}

// ---------------------------------------------------------------------------
// Synchronous projection accessors (consumed by the kit `userProfilesSource`)
// ---------------------------------------------------------------------------

/**
 * Prime the read-through projection cache from the Rust file family.
 *
 * Callers that need the synchronous `userProfilesSource.list()` projection
 * must `await` this once after mount so the cache reflects host truth.
 */
export async function ensureAccountProfileLibraryLoaded(): Promise<void> {
  if (libraryProjectionCache) {
    return;
  }
  if (!hasTauriInvoke()) {
    return;
  }
  await loadAccountProfileLibrary();
}

/**
 * Synchronous read-through projection of the editable library profiles.
 *
 * This is the projection feeding the kit's synchronous `userProfilesSource`.
 * It is never authored locally — it only ever reflects the last Rust file
 * family read. Empty until `ensureAccountProfileLibraryLoaded()` resolves.
 */
export function getCachedAccountProfileLibraryProfiles(): NimiAIProfile[] {
  if (!libraryProjectionCache) {
    return [];
  }
  return libraryProjectionCache.profiles.map((entry) => entry.profile);
}

/** Synchronous read-through projection accessor for the full library state. */
export function getCachedAccountProfileLibrary(): NimiAccountProfileLibraryProjection | null {
  return libraryProjectionCache;
}

// ---------------------------------------------------------------------------
// Profile id helpers
// ---------------------------------------------------------------------------

/**
 * Generate a fresh library profile id. The Rust host rejects the reserved
 * `default` id and any unsafe path segment, so this returns a prefixed,
 * path-safe id.
 */
export function generateLibraryProfileId(): string {
  return createNimiClientId('user');
}

/** Create an empty editable library profile shell for the create flow. */
export function createEmptyLibraryProfile(profileId?: string): NimiAIProfile {
  return {
    profileId: profileId || generateLibraryProfileId(),
    title: '',
    description: '',
    tags: [],
    capabilities: {},
  };
}
