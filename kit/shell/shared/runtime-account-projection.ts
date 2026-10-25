import { AccountReasonCode, RuntimeReasonCode } from '@nimiplatform/kit/core/sdk-contract';

type JsonObject = Record<string, unknown>;

function assertRecord(value: unknown, message: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as JsonObject;
}

export type DesktopAccountSessionState =
  | 'anonymous'
  | 'login-pending'
  | 'authenticated'
  | 'refresh-pending'
  | 'expired'
  | 'reauth-required'
  | 'switching'
  | 'logging-out'
  | 'unavailable';

export type DesktopAccountProjection = {
  accountId: string;
  displayName: string;
  realmEnvironmentId: string;
};

export type DesktopAccountAuditDiagnostic = { reasonCode: RuntimeReasonCode; actionHint: string; message: string };

export function parseAccountAuditDiagnostic(value: unknown): DesktopAccountAuditDiagnostic | undefined {
  if (value == null) return undefined;
  const record = assertRecord(value, 'account audit diagnostic is invalid');
  assertExactKeys(record, ['reasonCode', 'actionHint', 'message'], 'account audit diagnostic');
  if (record.reasonCode !== RuntimeReasonCode.AUDIT_RESULT_UNRECORDED || record.actionHint !== 'inspect_runtime_audit'
    || typeof record.message !== 'string' || record.message.length > 1024) throw new Error('account audit diagnostic is invalid');
  return { reasonCode: RuntimeReasonCode.AUDIT_RESULT_UNRECORDED, actionHint: record.actionHint, message: record.message };
}

export type DesktopAccountSessionStatus = {
  auditDiagnostic?: DesktopAccountAuditDiagnostic;
  sequence: string;
  state: DesktopAccountSessionState;
  /** Runtime-owned opaque equality value; never authority or a credential. */
  authorizationRevision: string;
  reasonCode: RuntimeReasonCode;
  accountReasonCode: AccountReasonCode;
  accountProjection?: DesktopAccountProjection;
};

export type DesktopAccountSessionDeliveryKind = 'snapshot' | 'replay' | 'live';

export type DesktopAccountSessionEvent = DesktopAccountSessionStatus & {
  deliveryKind: DesktopAccountSessionDeliveryKind;
  replayTruncated: boolean;
};

const ACCOUNT_STATES = new Set<DesktopAccountSessionState>([
  'anonymous',
  'login-pending',
  'authenticated',
  'refresh-pending',
  'expired',
  'reauth-required',
  'switching',
  'logging-out',
  'unavailable',
]);

export function assertExactKeys(record: JsonObject, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains forbidden fields: ${unexpected.join(', ')}`);
  }
}

export function parseString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label}: ${field} must be a string`);
  }
  return value;
}

export function parseExactNonEmptyString(
  value: unknown,
  field: string,
  label: string,
  maxLength = 4_096,
): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
    || value.includes('\0')) {
    throw new Error(`${label}: ${field} must be an exact non-empty string`);
  }
  return value;
}

export function parseBoolean(value: unknown, field: string, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label}: ${field} must be a boolean`);
  }
  return value;
}

export function parseInteger(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label}: ${field} must be an integer`);
  }
  return value;
}

export function parseKnownEnumInteger(
  value: unknown,
  field: string,
  label: string,
  enumType: Record<number, string>,
): number {
  const parsed = parseInteger(value, field, label);
  if (parsed === 0 || typeof enumType[parsed] !== 'string') {
    throw new Error(`${label}: ${field} is not an admitted enum value`);
  }
  return parsed;
}

export function parseSequence(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label}: ${field} must be a canonical unsigned decimal string`);
  }
  if (BigInt(value) > 18_446_744_073_709_551_615n) {
    throw new Error(`${label}: ${field} exceeds uint64`);
  }
  return value;
}

export function parseSafeAccountProjection(
  value: unknown,
  label: string,
): DesktopAccountProjection | undefined {
  if (value === undefined || value === null) return undefined;
  const projection = assertRecord(value, `${label} accountProjection is invalid`);
  assertExactKeys(
    projection,
    ['accountId', 'displayName', 'realmEnvironmentId'],
    `${label} accountProjection`,
  );
  return {
    accountId: parseExactNonEmptyString(projection.accountId, 'accountProjection.accountId', label),
    displayName: parseString(projection.displayName, 'accountProjection.displayName', label),
    realmEnvironmentId: parseExactNonEmptyString(
      projection.realmEnvironmentId,
      'accountProjection.realmEnvironmentId',
      label,
    ),
  };
}

// @nimi-authority: rule.nimi.runtime.protected-session.r031
export function parseDesktopAccountSessionStatus(value: unknown): DesktopAccountSessionStatus {
  const record = assertRecord(value, 'runtime_account_session_status returned invalid payload');
  assertExactKeys(record, [
    'sequence',
    'state',
    'authorizationRevision',
    'reasonCode',
    'auditDiagnostic',
    'accountReasonCode',
    'accountProjection',
  ], 'runtime_account_session_status');
  const sequence = parseSequence(record.sequence, 'sequence', 'runtime_account_session_status');
  const state = parseExactNonEmptyString(
    record.state,
    'state',
    'runtime_account_session_status',
  ) as DesktopAccountSessionState;
  if (!ACCOUNT_STATES.has(state)) {
    throw new Error(`runtime_account_session_status returned unsupported state: ${state}`);
  }
  let accountProjection: DesktopAccountProjection | undefined;
  accountProjection = parseSafeAccountProjection(
    record.accountProjection,
    'runtime_account_session_status',
  );
  if (state === 'authenticated' && !accountProjection) {
    throw new Error('runtime_account_session_status authenticated state requires accountProjection');
  }
  const authorizationRevision = parseString(record.authorizationRevision, 'authorizationRevision', 'runtime_account_session_status');
  if (authorizationRevision.length > 64
    || authorizationRevision !== authorizationRevision.trim()
    || authorizationRevision.includes('\0')
    || new TextEncoder().encode(authorizationRevision).byteLength > 64
    || (state === 'authenticated' && authorizationRevision.length === 0)
    || (state !== 'authenticated' && state !== 'refresh-pending' && authorizationRevision.length !== 0)) {
    throw new Error('runtime_account_session_status authorizationRevision is invalid for its state');
  }
  return {
    ...(record.auditDiagnostic == null ? {} : { auditDiagnostic: parseAccountAuditDiagnostic(record.auditDiagnostic) }),
    sequence,
    state,
    authorizationRevision,
    reasonCode: parseKnownEnumInteger(
      record.reasonCode,
      'reasonCode',
      'runtime_account_session_status',
      RuntimeReasonCode as unknown as Record<number, string>,
    ) as RuntimeReasonCode,
    accountReasonCode: parseKnownEnumInteger(
      record.accountReasonCode,
      'accountReasonCode',
      'runtime_account_session_status',
      AccountReasonCode as unknown as Record<number, string>,
    ) as AccountReasonCode,
    ...(accountProjection ? { accountProjection } : {}),
  };
}

export function parseDesktopAccountSessionEvent(value: unknown): DesktopAccountSessionEvent {
  const label = 'runtime_account_session_events';
  const record = assertRecord(value, `${label} returned invalid event`);
  assertExactKeys(record, [
    'sequence',
    'deliveryKind',
    'state',
    'authorizationRevision',
    'reasonCode',
    'auditDiagnostic',
    'accountReasonCode',
    'accountProjection',
    'replayTruncated',
  ], label);
  const deliveryKind = parseExactNonEmptyString(
    record.deliveryKind,
    'deliveryKind',
    label,
    32,
  ) as DesktopAccountSessionDeliveryKind;
  if (!['snapshot', 'replay', 'live'].includes(deliveryKind)) {
    throw new Error(`${label} returned unsupported deliveryKind: ${deliveryKind}`);
  }
  const status = parseDesktopAccountSessionStatus({
    sequence: record.sequence,
    state: record.state,
    authorizationRevision: record.authorizationRevision,
    reasonCode: record.reasonCode,
    accountReasonCode: record.accountReasonCode,
    auditDiagnostic: record.auditDiagnostic,
    accountProjection: record.accountProjection,
  });
  return {
    ...status,
    deliveryKind,
    replayTruncated: parseBoolean(record.replayTruncated, 'replayTruncated', label),
  };
}
