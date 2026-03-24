import { asNimiError } from '../../runtime/errors.js';
import { createNimiError } from '../../runtime/errors.js';
import { asRecord } from '../../internal/utils.js';
import type { JsonObject } from '../../internal/utils.js';
import { ReasonCode } from '../../types/index.js';
import type { Realm } from '../client.js';

const ACCOUNT_DATA_UNAVAILABLE_HINT = 'upgrade_realm_account_data_api';

export type AccountDataTaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNAVAILABLE';

export type RequestDataExportInput = {
  format?: 'JSON' | 'CSV' | 'ZIP';
  includeMedia?: boolean;
  includeMessages?: boolean;
  locale?: string;
};

export type RequestDataExportOutput = {
  accepted: boolean;
  taskId?: string;
  status: AccountDataTaskStatus;
  reasonCode?: string;
  actionHint?: string;
  message?: string;
  requestedAt?: string;
};

export type RequestAccountDeletionInput = {
  reason?: string;
  feedback?: string;
  immediate?: boolean;
  confirmPhrase?: string;
};

export type RequestAccountDeletionOutput = {
  accepted: boolean;
  taskId?: string;
  status: AccountDataTaskStatus;
  reasonCode?: string;
  actionHint?: string;
  message?: string;
  scheduledDeletionAt?: string;
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

function pickText(record: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function pickStatus(record: JsonObject, accepted: boolean): AccountDataTaskStatus {
  const raw = pickText(record, ['status', 'state', 'taskStatus', 'task_state']).toUpperCase();
  if (
    raw === 'PENDING'
    || raw === 'PROCESSING'
    || raw === 'COMPLETED'
    || raw === 'FAILED'
    || raw === 'UNAVAILABLE'
  ) {
    return raw;
  }
  return accepted ? 'PENDING' : 'FAILED';
}

function parseAccepted(record: JsonObject): boolean {
  const acceptedValue = record.accepted;
  if (typeof acceptedValue === 'boolean') {
    return acceptedValue;
  }
  const okValue = record.ok;
  if (typeof okValue === 'boolean') {
    return okValue;
  }
  return false;
}

function parseTaskId(record: JsonObject): string {
  return pickText(record, ['taskId', 'jobId', 'id']);
}

function normalizeDataExportOutput(payload: unknown): RequestDataExportOutput {
  const record = asRecord(payload);
  const accepted = parseAccepted(record);
  return {
    accepted,
    taskId: parseTaskId(record) || undefined,
    status: pickStatus(record, accepted),
    reasonCode: pickText(record, ['reasonCode', 'reason_code']) || undefined,
    actionHint: pickText(record, ['actionHint', 'action_hint']) || undefined,
    message: pickText(record, ['message']) || undefined,
    requestedAt: pickText(record, ['requestedAt', 'requested_at', 'createdAt']) || undefined,
  };
}

function normalizeAccountDeletionOutput(payload: unknown): RequestAccountDeletionOutput {
  const record = asRecord(payload);
  const accepted = parseAccepted(record);
  return {
    accepted,
    taskId: parseTaskId(record) || undefined,
    status: pickStatus(record, accepted),
    reasonCode: pickText(record, ['reasonCode', 'reason_code']) || undefined,
    actionHint: pickText(record, ['actionHint', 'action_hint']) || undefined,
    message: pickText(record, ['message']) || undefined,
    scheduledDeletionAt: pickText(
      record,
      ['scheduledDeletionAt', 'scheduled_deletion_at', 'effectiveAt', 'effective_at'],
    ) || undefined,
  };
}

function isBackendUnavailable(error: ReturnType<typeof asNimiError>): boolean {
  const httpStatus = Number(error.details?.httpStatus || 0);
  return error.reasonCode === ReasonCode.REALM_NOT_FOUND
    || httpStatus === 404
    || httpStatus === 405
    || httpStatus === 501;
}

function createBackendUnavailableError(
  operation: 'export' | 'delete',
  error: ReturnType<typeof asNimiError>,
) {
  return createNimiError({
    message: operation === 'export'
      ? 'realm account-data export backend is not available'
      : 'realm account-deletion backend is not available',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: ACCOUNT_DATA_UNAVAILABLE_HINT,
    source: 'realm',
    details: {
      ...asRecord(error.details),
      operation,
      originalReasonCode: error.reasonCode,
    },
  });
}

export async function requestDataExport(
  realm: Realm,
  input: RequestDataExportInput = {},
): Promise<RequestDataExportOutput> {
  try {
    const payload = await realm.services.MeaccountdataService.requestDataExport(input);
    return normalizeDataExportOutput(payload);
  } catch (error) {
    const normalized = asNimiError(error, {
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'check_realm_account_data_backend',
      source: 'realm',
    });
    if (isBackendUnavailable(normalized)) {
      throw createBackendUnavailableError('export', normalized);
    }
    throw normalized;
  }
}

export async function requestAccountDeletion(
  realm: Realm,
  input: RequestAccountDeletionInput = {},
): Promise<RequestAccountDeletionOutput> {
  try {
    const payload = await realm.services.MeaccountdataService.requestAccountDeletion(input);
    return normalizeAccountDeletionOutput(payload);
  } catch (error) {
    const normalized = asNimiError(error, {
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'check_realm_account_data_backend',
      source: 'realm',
    });
    if (isBackendUnavailable(normalized)) {
      throw createBackendUnavailableError('delete', normalized);
    }
    throw normalized;
  }
}
