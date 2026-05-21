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

import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

/** A projected account app-library row. Mirrors the Rust `AccountAppLibraryRow`. */
export interface AccountAppLibraryRow {
  readonly appId: string;
  readonly libraryState: 'enabled' | 'disabled' | 'removed';
  readonly installed: boolean;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: 'keep_on_uninstall' | 'delete_on_uninstall';
}

/** The account app-library record. Mirrors the Rust `AccountAppLibraryRecord`. */
export interface AccountAppLibraryRecord {
  readonly schemaVersion: number;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly AccountAppLibraryRow[];
}

/** The lifecycle-terminal mutation the renderer requests. */
export type AccountAppLibraryMutationKind =
  | 'installed_enabled'
  | 'uninstalled_keep_record'
  | 'removed_from_library';

const LIBRARY_STATES = new Set<AccountAppLibraryRow['libraryState']>([
  'enabled',
  'disabled',
  'removed',
]);
const DATA_POLICIES = new Set<AccountAppLibraryRow['dataPolicy']>([
  'keep_on_uninstall',
  'delete_on_uninstall',
]);

function parseRow(value: unknown, index: number): AccountAppLibraryRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`library.json apps[${index}] is not an object`);
  }
  const record = value as Record<string, unknown>;
  const appId = String(record.appId ?? '').trim();
  if (!appId) {
    throw new Error(`library.json apps[${index}] is missing appId`);
  }
  const libraryState = String(record.libraryState ?? '');
  if (!LIBRARY_STATES.has(libraryState as AccountAppLibraryRow['libraryState'])) {
    throw new Error(`library.json apps[${index}] has an invalid libraryState: ${libraryState}`);
  }
  const dataPolicy = String(record.dataPolicy ?? '');
  if (!DATA_POLICIES.has(dataPolicy as AccountAppLibraryRow['dataPolicy'])) {
    throw new Error(`library.json apps[${index}] has an invalid dataPolicy: ${dataPolicy}`);
  }
  const lastOpenedAt = String(record.lastOpenedAt ?? '').trim();
  return {
    appId,
    libraryState: libraryState as AccountAppLibraryRow['libraryState'],
    installed: record.installed === true,
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
    dataPolicy: dataPolicy as AccountAppLibraryRow['dataPolicy'],
  };
}

function parseRecord(value: unknown): AccountAppLibraryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('library.json record is not an object');
  }
  const record = value as Record<string, unknown>;
  const schemaVersion = Number(record.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error('library.json record has an invalid schemaVersion');
  }
  const accountId = String(record.accountId ?? '').trim();
  if (!accountId) {
    throw new Error('library.json record is missing accountId');
  }
  const updatedAt = String(record.updatedAt ?? '').trim();
  if (!updatedAt) {
    throw new Error('library.json record is missing updatedAt');
  }
  if (!Array.isArray(record.apps)) {
    throw new Error('library.json record apps must be an array');
  }
  return {
    schemaVersion,
    accountId,
    updatedAt,
    apps: record.apps.map(parseRow),
  };
}

function parseOptionalRecord(value: unknown): AccountAppLibraryRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseRecord(value);
}

/** Read the account app-library projection, or `null` when not yet written. */
export async function getAccountAppLibrary(): Promise<AccountAppLibraryRecord | null> {
  if (!hasTauriInvoke()) {
    throw new Error('account_app_library_get requires the desktop Tauri runtime');
  }
  return invokeChecked('account_app_library_get', {}, parseOptionalRecord);
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
    parseRecord,
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
