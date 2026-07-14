import { createNimiError } from '../../types';

export type NimiAppAccountInventoryState =
  | 'verified'
  | 'entitled'
  | 'disabled'
  | 'removed'
  | 'revoked';

export type NimiAppAccountInstallState =
  | 'not-present'
  | 'local-record-active'
  | 'local-record-dormant'
  | 'removed';

export interface NimiAppAccountInventoryRow {
  readonly appId: string;
  readonly accountState: NimiAppAccountInventoryState;
  readonly installState: NimiAppAccountInstallState;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: string;
  readonly verifiedAt?: string;
  readonly source?: string;
  readonly detail?: string;
}

export interface NimiAppAccountInventoryRecord {
  readonly schemaVersion: 2;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly NimiAppAccountInventoryRow[];
}

export interface NimiAppAccountInventoryProjection {
  readonly exists: boolean;
  readonly record?: NimiAppAccountInventoryRecord;
  readonly reasonCode?: string;
  readonly detail?: string;
}

const NIMI_APP_ACCOUNT_INVENTORY_STATES = new Set<NimiAppAccountInventoryState>([
  'verified',
  'entitled',
  'disabled',
  'removed',
  'revoked',
]);

const NIMI_APP_ACCOUNT_INSTALL_STATES = new Set<NimiAppAccountInstallState>([
  'not-present',
  'local-record-active',
  'local-record-dormant',
  'removed',
]);

export function parseNimiAppAccountInventoryRow(
  value: unknown,
  index: number,
): NimiAppAccountInventoryRow {
  const row = requireNimiAppAccountInventoryRecordLike(
    value,
    `account app-inventory apps[${index}]`,
  );
  const lastOpenedAt = optionalNimiAppAccountInventoryString(row.lastOpenedAt);
  const verifiedAt = optionalNimiAppAccountInventoryString(row.verifiedAt);
  const source = optionalNimiAppAccountInventoryString(row.source);
  const detail = optionalNimiAppAccountInventoryString(row.detail);
  return {
    appId: requireNimiAppAccountInventoryString(
      row.appId,
      `account app-inventory apps[${index}].appId`,
    ),
    accountState: requireNimiAppAccountInventoryState(row.accountState, index),
    installState: requireNimiAppAccountInstallState(row.installState, index),
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
    dataPolicy: requireNimiAppAccountInventoryString(
      row.dataPolicy,
      `account app-inventory apps[${index}].dataPolicy`,
    ),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(source ? { source } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function parseNimiAppAccountInventoryRecord(value: unknown): NimiAppAccountInventoryRecord {
  const record = requireNimiAppAccountInventoryRecordLike(value, 'account app-inventory record');
  if (record.schemaVersion !== 2) {
    throw accountInventoryError('account app-inventory record must use schemaVersion 2');
  }
  const apps = record.apps;
  if (!Array.isArray(apps)) {
    throw accountInventoryError('account app-inventory record.apps must be an array');
  }
  const parsedApps = apps.map(parseNimiAppAccountInventoryRow);
  const seenAppIds = new Set<string>();
  for (const app of parsedApps) {
    if (seenAppIds.has(app.appId)) {
      throw accountInventoryError(`account app-inventory record.apps contains duplicate appId: ${app.appId}`);
    }
    seenAppIds.add(app.appId);
  }
  return {
    schemaVersion: 2,
    accountId: requireNimiAppAccountInventoryString(
      record.accountId,
      'account app-inventory record.accountId',
    ),
    updatedAt: requireNimiAppAccountInventoryString(
      record.updatedAt,
      'account app-inventory record.updatedAt',
    ),
    apps: parsedApps,
  };
}

export function parseOptionalNimiAppAccountInventoryRecord(
  value: unknown,
): NimiAppAccountInventoryRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseNimiAppAccountInventoryRecord(value);
}

export function parseNimiAppAccountInventoryProjection(
  value: unknown,
): NimiAppAccountInventoryProjection {
  const projection = requireNimiAppAccountInventoryRecordLike(value, 'account app-inventory projection');
  const reasonCode = optionalNimiAppAccountInventoryString(projection.reasonCode);
  const detail = optionalNimiAppAccountInventoryString(projection.detail);
  if (projection.exists !== true) {
    return {
      exists: false,
      ...(reasonCode ? { reasonCode } : {}),
      ...(detail ? { detail } : {}),
    };
  }
  return {
    exists: true,
    record: parseNimiAppAccountInventoryRecord(projection.record),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function parseOptionalNimiAppAccountInventoryProjection(
  value: unknown,
): NimiAppAccountInventoryProjection | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseNimiAppAccountInventoryProjection(value);
}

function requireNimiAppAccountInventoryRecordLike(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw accountInventoryError(`${field} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requireNimiAppAccountInventoryString(value: unknown, field: string): string {
  const normalized = optionalNimiAppAccountInventoryString(value);
  if (!normalized) {
    throw accountInventoryError(`${field} is required`);
  }
  return normalized;
}

function optionalNimiAppAccountInventoryString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function requireNimiAppAccountInventoryState(
  value: unknown,
  index: number,
): NimiAppAccountInventoryState {
  const normalized = String(value ?? '').trim();
  if (!NIMI_APP_ACCOUNT_INVENTORY_STATES.has(normalized as NimiAppAccountInventoryState)) {
    throw accountInventoryError(`account app-inventory apps[${index}].accountState is invalid: ${normalized}`);
  }
  return normalized as NimiAppAccountInventoryState;
}

function requireNimiAppAccountInstallState(
  value: unknown,
  index: number,
): NimiAppAccountInstallState {
  const normalized = String(value ?? '').trim();
  if (!NIMI_APP_ACCOUNT_INSTALL_STATES.has(normalized as NimiAppAccountInstallState)) {
    throw accountInventoryError(`account app-inventory apps[${index}].installState is invalid: ${normalized}`);
  }
  return normalized as NimiAppAccountInstallState;
}

function accountInventoryError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_APP_ACCOUNT_INVENTORY_CONTRACT_INVALID',
    actionHint: 'check_runtime_account_app_inventory_projection',
    source: 'sdk',
  });
}
