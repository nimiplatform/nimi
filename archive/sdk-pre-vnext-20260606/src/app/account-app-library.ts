export interface AccountAppLibraryRow {
  readonly appId: string;
  readonly libraryState: 'enabled' | 'disabled' | 'removed';
  readonly installed: boolean;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: 'keep_on_uninstall' | 'delete_on_uninstall';
}

export interface AccountAppLibraryRecord {
  readonly schemaVersion: number;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly AccountAppLibraryRow[];
}

const LIBRARY_STATES = new Set<AccountAppLibraryRow['libraryState']>([
  'enabled',
  'disabled',
  'removed',
]);
const DATA_POLICIES = new Set<AccountAppLibraryRow['dataPolicy']>([
  'keep_on_uninstall',
  'delete_on_uninstall',
]);

export function parseAccountAppLibraryRow(value: unknown, index: number): AccountAppLibraryRow {
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

export function parseAccountAppLibraryRecord(value: unknown): AccountAppLibraryRecord {
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
    apps: record.apps.map(parseAccountAppLibraryRow),
  };
}

export function parseOptionalAccountAppLibraryRecord(value: unknown): AccountAppLibraryRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseAccountAppLibraryRecord(value);
}
