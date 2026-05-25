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

import type { AIProfile } from '@nimiplatform/sdk/ai';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

// ---------------------------------------------------------------------------
// Projection types (mirror the Rust `AccountProfileLibraryProjection`)
// ---------------------------------------------------------------------------

export type LibraryProfileOrigin = 'account-default' | 'user' | 'imported';

/** One editable library profile projected from the Rust file family. */
export type LibraryProfile = {
  readonly profileId: string;
  readonly origin: Exclude<LibraryProfileOrigin, 'account-default'>;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly profile: AIProfile;
};

/** One `index.json` row projected from the Rust library index. */
export type LibraryIndexEntry = {
  readonly profileId: string;
  readonly title: string;
  readonly origin: LibraryProfileOrigin;
  readonly relativePath: string;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly updatedAt: string;
};

/** The full account profile library projection returned by the Rust host. */
export type AccountProfileLibraryProjection = {
  readonly accountId: string;
  readonly libraryPath: string;
  readonly index: {
    readonly schemaVersion: number;
    readonly accountId: string;
    readonly updatedAt: string;
    readonly entries: readonly LibraryIndexEntry[];
  };
  readonly profiles: readonly LibraryProfile[];
};

// ---------------------------------------------------------------------------
// Projection parsing — fail closed on a malformed host payload
// ---------------------------------------------------------------------------

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid payload`);
  }
  return value as Record<string, unknown>;
}

function parseAIProfile(value: unknown): AIProfile {
  const record = asRecord(value, 'library AIProfile payload');
  const profileId = String(record.profileId || '').trim();
  const title = String(record.title || '').trim();
  if (!profileId) {
    throw new Error('library AIProfile payload is missing profileId');
  }
  if (!title) {
    throw new Error('library AIProfile payload is missing title');
  }
  if (!record.capabilities || typeof record.capabilities !== 'object'
    || Array.isArray(record.capabilities)) {
    throw new Error('library AIProfile payload capabilities must be an object');
  }
  return {
    profileId,
    title,
    description: typeof record.description === 'string' ? record.description : '',
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => String(tag || '')).filter(Boolean)
      : [],
    capabilities: record.capabilities as AIProfile['capabilities'],
  };
}

function parseOrigin(value: unknown): LibraryProfileOrigin {
  const origin = String(value || '').trim();
  if (origin === 'account-default' || origin === 'user' || origin === 'imported') {
    return origin;
  }
  throw new Error(`account profile library returned an invalid origin: ${origin}`);
}

function parseLibraryProfile(value: unknown): LibraryProfile {
  const record = asRecord(value, 'library profile');
  const origin = parseOrigin(record.origin);
  if (origin === 'account-default') {
    throw new Error('account profile library projected the Account Default Profile as editable');
  }
  return {
    profileId: String(record.profileId || '').trim(),
    origin,
    editable: record.editable === true,
    removable: record.removable === true,
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
    profile: parseAIProfile(record.profile),
  };
}

function parseIndexEntry(value: unknown): LibraryIndexEntry {
  const record = asRecord(value, 'library index entry');
  return {
    profileId: String(record.profileId || '').trim(),
    title: String(record.title || ''),
    origin: parseOrigin(record.origin),
    relativePath: String(record.relativePath || ''),
    editable: record.editable === true,
    removable: record.removable === true,
    updatedAt: String(record.updatedAt || ''),
  };
}

function parseLibraryProjection(value: unknown): AccountProfileLibraryProjection {
  const record = asRecord(value, 'account profile library');
  const index = asRecord(record.index, 'account profile library index');
  const entries = Array.isArray(index.entries)
    ? index.entries.map(parseIndexEntry)
    : [];
  const profiles = Array.isArray(record.profiles)
    ? record.profiles.map(parseLibraryProfile)
    : [];
  return {
    accountId: String(record.accountId || ''),
    libraryPath: String(record.libraryPath || ''),
    index: {
      schemaVersion: Number(index.schemaVersion || 0),
      accountId: String(index.accountId || ''),
      updatedAt: String(index.updatedAt || ''),
      entries,
    },
    profiles,
  };
}

function parseExportedProfiles(value: unknown): AIProfile[] {
  if (!Array.isArray(value)) {
    throw new Error('account profile library export returned an invalid payload');
  }
  return value.map(parseAIProfile);
}

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
  return invokeChecked('account_profile_library_list', {}, parseLibraryProjection);
}

/** Create a new user-authored library profile under `user/`. */
export async function createAccountProfileLibraryProfile(
  profile: AIProfile,
): Promise<AccountProfileLibraryProjection> {
  requireTauri('account_profile_library_create');
  return invokeChecked(
    'account_profile_library_create',
    { payload: { profile } },
    parseLibraryProjection,
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
    parseLibraryProjection,
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
    parseLibraryProjection,
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
    parseExportedProfiles,
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
    parseLibraryProjection,
  );
}
