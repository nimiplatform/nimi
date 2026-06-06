import { createNimiError } from '../../types';

export type NimiAppAccountLibraryState = 'enabled' | 'disabled' | 'removed';
export type NimiAppAccountLibraryDataPolicy = 'keep_on_uninstall' | 'delete_on_uninstall';

export interface NimiAppAccountLibraryRow {
  readonly appId: string;
  readonly libraryState: NimiAppAccountLibraryState;
  readonly installed: boolean;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: NimiAppAccountLibraryDataPolicy;
}

export interface NimiAppAccountLibraryRecord {
  readonly schemaVersion: number;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly NimiAppAccountLibraryRow[];
}

const NIMI_APP_ACCOUNT_LIBRARY_STATES = new Set<NimiAppAccountLibraryState>([
  'enabled',
  'disabled',
  'removed',
]);

const NIMI_APP_ACCOUNT_LIBRARY_DATA_POLICIES = new Set<NimiAppAccountLibraryDataPolicy>([
  'keep_on_uninstall',
  'delete_on_uninstall',
]);

export function parseNimiAppAccountLibraryRow(
  value: unknown,
  index: number,
): NimiAppAccountLibraryRow {
  const record = requireNimiAppAccountLibraryRecordLike(
    value,
    `account app-library apps[${index}]`,
  );
  const appId = requireNimiAppAccountLibraryString(
    record.appId,
    `account app-library apps[${index}].appId`,
  );
  const libraryState = requireNimiAppAccountLibraryState(record.libraryState, index);
  const dataPolicy = requireNimiAppAccountLibraryDataPolicy(record.dataPolicy, index);
  const lastOpenedAt = optionalNimiAppAccountLibraryString(record.lastOpenedAt);

  return {
    appId,
    libraryState,
    installed: record.installed === true,
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
    dataPolicy,
  };
}

export function parseNimiAppAccountLibraryRecord(value: unknown): NimiAppAccountLibraryRecord {
  const record = requireNimiAppAccountLibraryRecordLike(value, 'account app-library record');
  const schemaVersion = Number(record.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw accountLibraryError('account app-library record has an invalid schemaVersion');
  }
  const accountId = requireNimiAppAccountLibraryString(
    record.accountId,
    'account app-library record.accountId',
  );
  const updatedAt = requireNimiAppAccountLibraryString(
    record.updatedAt,
    'account app-library record.updatedAt',
  );
  if (!Array.isArray(record.apps)) {
    throw accountLibraryError('account app-library record.apps must be an array');
  }

  return {
    schemaVersion,
    accountId,
    updatedAt,
    apps: record.apps.map(parseNimiAppAccountLibraryRow),
  };
}

export function parseOptionalNimiAppAccountLibraryRecord(
  value: unknown,
): NimiAppAccountLibraryRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseNimiAppAccountLibraryRecord(value);
}

function requireNimiAppAccountLibraryRecordLike(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw accountLibraryError(`${field} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requireNimiAppAccountLibraryString(value: unknown, field: string): string {
  const normalized = optionalNimiAppAccountLibraryString(value);
  if (!normalized) {
    throw accountLibraryError(`${field} is required`);
  }
  return normalized;
}

function optionalNimiAppAccountLibraryString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function requireNimiAppAccountLibraryState(
  value: unknown,
  index: number,
): NimiAppAccountLibraryState {
  const normalized = String(value ?? '').trim();
  if (!NIMI_APP_ACCOUNT_LIBRARY_STATES.has(normalized as NimiAppAccountLibraryState)) {
    throw accountLibraryError(`account app-library apps[${index}].libraryState is invalid: ${normalized}`);
  }
  return normalized as NimiAppAccountLibraryState;
}

function requireNimiAppAccountLibraryDataPolicy(
  value: unknown,
  index: number,
): NimiAppAccountLibraryDataPolicy {
  const normalized = String(value ?? '').trim();
  if (!NIMI_APP_ACCOUNT_LIBRARY_DATA_POLICIES.has(normalized as NimiAppAccountLibraryDataPolicy)) {
    throw accountLibraryError(`account app-library apps[${index}].dataPolicy is invalid: ${normalized}`);
  }
  return normalized as NimiAppAccountLibraryDataPolicy;
}

function accountLibraryError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_APP_ACCOUNT_LIBRARY_CONTRACT_INVALID',
    actionHint: 'check_runtime_account_app_library_projection',
    source: 'sdk',
  });
}
