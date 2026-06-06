import type {
  RealmTypedCallOptions,
  RealmTypedClient,
  RequestAccountDeletionDto,
  RequestDataExportDto,
} from '../core-generated/realm-typed-client';
import {
  ReasonCode,
  asNimiError,
  createNimiError,
} from '../types';

const ACCOUNT_DATA_UNAVAILABLE_HINT = 'upgrade_realm_account_data_api';

export type NimiRealmAccountDataTaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNAVAILABLE';

export type NimiRealmRequestDataExportInput = RequestDataExportDto;
export type NimiRealmRequestAccountDeletionInput = RequestAccountDeletionDto;

export type NimiRealmRequestDataExportOutput = {
  readonly accepted: boolean;
  readonly taskId?: string;
  readonly status: NimiRealmAccountDataTaskStatus;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly message?: string;
  readonly requestedAt?: string;
};

export type NimiRealmRequestAccountDeletionOutput = {
  readonly accepted: boolean;
  readonly taskId?: string;
  readonly status: NimiRealmAccountDataTaskStatus;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly message?: string;
  readonly scheduledDeletionAt?: string;
};

export interface NimiRealmAccountDataApi {
  readonly account: Pick<RealmTypedClient, 'requestAccountDeletion' | 'requestDataExport'>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return String(value || '').trim();
}

function pickText(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function pickStatus(record: Record<string, unknown>, accepted: boolean): NimiRealmAccountDataTaskStatus {
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

function parseAccepted(record: Record<string, unknown>): boolean {
  const acceptedValue = record.accepted;
  if (typeof acceptedValue === 'boolean') {
    return acceptedValue;
  }
  const okValue = record.ok;
  if (typeof okValue === 'boolean') {
    return okValue;
  }
  return true;
}

function parseTaskId(record: Record<string, unknown>): string {
  return pickText(record, ['taskId', 'jobId', 'id']);
}

function normalizeNimiRealmDataExportOutput(payload: unknown): NimiRealmRequestDataExportOutput {
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

function normalizeNimiRealmAccountDeletionOutput(payload: unknown): NimiRealmRequestAccountDeletionOutput {
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

function normalizeAccountDataError(operation: 'export' | 'delete', error: unknown): Error {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'check_realm_account_data_backend',
    source: 'realm',
  });
  const httpStatus = Number(normalized.details?.httpStatus || 0);
  if (
    normalized.reasonCode === ReasonCode.REALM_NOT_FOUND
    || httpStatus === 404
    || httpStatus === 405
    || httpStatus === 501
  ) {
    return createNimiError({
      message: operation === 'export'
        ? 'Realm account-data export backend is not available.'
        : 'Realm account-deletion backend is not available.',
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: ACCOUNT_DATA_UNAVAILABLE_HINT,
      source: 'realm',
      details: {
        ...(normalized.details || {}),
        operation,
        originalReasonCode: normalized.reasonCode,
      },
    });
  }
  return normalized;
}

export async function requestNimiRealmDataExport(
  realm: NimiRealmAccountDataApi,
  input: NimiRealmRequestDataExportInput = {},
  options?: RealmTypedCallOptions,
): Promise<NimiRealmRequestDataExportOutput> {
  try {
    const payload = await realm.account.requestDataExport({ path: {}, body: input }, options);
    return normalizeNimiRealmDataExportOutput(payload);
  } catch (error) {
    throw normalizeAccountDataError('export', error);
  }
}

export async function requestNimiRealmAccountDeletion(
  realm: NimiRealmAccountDataApi,
  input: NimiRealmRequestAccountDeletionInput = {},
  options?: RealmTypedCallOptions,
): Promise<NimiRealmRequestAccountDeletionOutput> {
  try {
    const payload = await realm.account.requestAccountDeletion({ path: {}, body: input }, options);
    return normalizeNimiRealmAccountDeletionOutput(payload);
  } catch (error) {
    throw normalizeAccountDataError('delete', error);
  }
}
