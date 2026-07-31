export type TesterBoundaryError = {
  readonly reasonCode: string;
  readonly message: string;
};

const EXPECTED_REVOKED_REASON_CODES = [
  'permission-revoked',
  'local-app-permission-revoked',
] as const;

const EXPECTED_RESERVED_REASON_CODES = [
  'sdk-permission-not-admitted',
] as const;

export function normalizeTesterBoundaryError(error: unknown): TesterBoundaryError {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = nonEmptyText(record.reasonCode)
    || nonEmptyText(record.code)
    || (error instanceof Error ? nonEmptyText(error.message) : '')
    || 'local-app-boundary-check-failed';
  return {
    reasonCode,
    message: error instanceof Error ? nonEmptyText(error.message) || reasonCode : reasonCode,
  };
}

export function isExpectedRevokedPermissionError(error: unknown): boolean {
  return hasExpectedReasonCode(error, EXPECTED_REVOKED_REASON_CODES);
}

export function isExpectedReservedPermissionError(error: unknown): boolean {
  return hasExpectedReasonCode(error, EXPECTED_RESERVED_REASON_CODES);
}

export function canVerifyRevokedConversation(input: {
  readonly posture: string | undefined;
  readonly lastHandle: string | null;
  readonly lastAnchor: string | null;
}): boolean {
  return input.posture === 'prompt'
    && Boolean(input.lastHandle)
    && Boolean(input.lastAnchor);
}

function hasExpectedReasonCode(error: unknown, expected: readonly string[]): boolean {
  if (!error || typeof error !== 'object') return false;
  const reasonCode = nonEmptyText((error as { readonly reasonCode?: unknown }).reasonCode);
  return reasonCode !== '' && expected.includes(canonicalReasonCode(reasonCode));
}

function canonicalReasonCode(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
