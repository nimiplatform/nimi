import {
  AccountAppInstallState,
  AccountAppInventoryState,
  ReasonCode as RuntimeGeneratedReasonCode,
  type AccountAppInventoryRecord,
  type AccountAppInventoryRow,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeAccountAppInstallState,
  NimiRuntimeAccountAppInventoryProjection,
  NimiRuntimeAccountAppInventoryRecord,
  NimiRuntimeAccountAppInventoryRow,
  NimiRuntimeAccountAppInventoryState,
} from './app-lifecycle-types';
import {
  decodeNimiRuntimeAppLifecycleError,
  decodeNimiRuntimeReasonCode,
  normalizeNimiRuntimeAppLifecycleText,
  requireNimiRuntimeAppLifecycleProjectionText,
} from './app-lifecycle-decoder-utils';

export function decodeNimiRuntimeAccountAppInventoryProjection(
  response: {
    readonly exists?: boolean;
    readonly record?: AccountAppInventoryRecord;
    readonly reasonCode?: RuntimeGeneratedReasonCode;
    readonly detail?: string;
  } | undefined,
): NimiRuntimeAccountAppInventoryProjection {
  if (!response) {
    return decodeNimiRuntimeAppLifecycleError('runtime account app inventory response is missing');
  }
  const exists = response.exists === true;
  const reasonCode = decodeNimiRuntimeReasonCode(
    response.reasonCode ?? RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
  );
  const detail = normalizeNimiRuntimeAppLifecycleText(response.detail);
  if (!exists) {
    return {
      exists: false,
      ...(reasonCode ? { reasonCode } : {}),
      ...(detail ? { detail } : {}),
    };
  }
  return {
    exists: true,
    record: decodeNimiRuntimeAccountAppInventoryRecord(response.record),
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function decodeNimiRuntimeAccountAppInventoryRecord(
  record: AccountAppInventoryRecord | undefined,
): NimiRuntimeAccountAppInventoryRecord {
  if (!record) {
    return decodeNimiRuntimeAppLifecycleError('runtime account app inventory response exists without a record');
  }
  if (record.schemaVersion !== 2) {
    return decodeNimiRuntimeAppLifecycleError(
      `runtime account app inventory has unsupported schemaVersion: ${String(record.schemaVersion)}`,
    );
  }
  return {
    schemaVersion: 2,
    accountId: requireNimiRuntimeAppLifecycleProjectionText(
      record.accountId,
      'runtime account app inventory accountId',
    ),
    updatedAt: requireNimiRuntimeAppLifecycleProjectionText(
      record.updatedAt,
      'runtime account app inventory updatedAt',
    ),
    apps: (record.apps || []).map(decodeNimiRuntimeAccountAppInventoryRow),
  };
}

export function decodeNimiRuntimeAccountAppInventoryRow(
  row: AccountAppInventoryRow | undefined,
  index = 0,
): NimiRuntimeAccountAppInventoryRow {
  if (!row) {
    return decodeNimiRuntimeAppLifecycleError(`runtime account app inventory row ${index} is missing`);
  }
  const lastOpenedAt = normalizeNimiRuntimeAppLifecycleText(row.lastOpenedAt);
  const verifiedAt = normalizeNimiRuntimeAppLifecycleText(row.verifiedAt);
  const source = normalizeNimiRuntimeAppLifecycleText(row.source);
  const detail = normalizeNimiRuntimeAppLifecycleText(row.detail);
  return {
    appId: requireNimiRuntimeAppLifecycleProjectionText(row.appId, `runtime account app inventory apps[${index}].appId`),
    accountState: decodeNimiRuntimeAccountAppInventoryState(row.accountState),
    installState: decodeNimiRuntimeAccountAppInstallState(row.installState),
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
    dataPolicy: requireNimiRuntimeAppLifecycleProjectionText(
      row.dataPolicy,
      `runtime account app inventory apps[${index}].dataPolicy`,
    ),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(source ? { source } : {}),
    ...(detail ? { detail } : {}),
  };
}

function decodeNimiRuntimeAccountAppInventoryState(
  value: AccountAppInventoryState,
): NimiRuntimeAccountAppInventoryState {
  switch (value) {
    case AccountAppInventoryState.VERIFIED:
      return 'verified';
    case AccountAppInventoryState.ENTITLED:
      return 'entitled';
    case AccountAppInventoryState.DISABLED:
      return 'disabled';
    case AccountAppInventoryState.REMOVED:
      return 'removed';
    case AccountAppInventoryState.REVOKED:
      return 'revoked';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime account app inventory row has unspecified accountState: ${String(value)}`,
      );
  }
}

function decodeNimiRuntimeAccountAppInstallState(
  value: AccountAppInstallState,
): NimiRuntimeAccountAppInstallState {
  switch (value) {
    case AccountAppInstallState.NOT_INSTALLED:
      return 'not-present';
    case AccountAppInstallState.INSTALLED:
      return 'local-record-active';
    case AccountAppInstallState.REMOVED:
      return 'removed';
    default:
      return decodeNimiRuntimeAppLifecycleError(
        `runtime account app inventory row has unspecified installState: ${String(value)}`,
      );
  }
}
