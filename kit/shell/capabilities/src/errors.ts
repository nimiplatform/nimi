export const NIMI_STANDARD_SHELL_ERROR_CODES = [
  'capability-unavailable',
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-repair-required',
  'external-daemon-required',
  'runtime-permission-denied',
  'runtime-unauthenticated',
  'forbidden-renderer-access',
  'invalid-path',
  'not-found',
  'invalid-payload',
  'host-internal-error',
] as const;

export type NimiStandardShellErrorCode = (typeof NIMI_STANDARD_SHELL_ERROR_CODES)[number];

export type NimiStandardShellErrorSource = 'renderer' | 'tauri' | 'electron' | 'runtime' | 'host';

const NIMI_STANDARD_SHELL_ERROR_SOURCES: ReadonlySet<string> = new Set([
  'renderer',
  'tauri',
  'electron',
  'runtime',
  'host',
]);

export interface NimiStandardShellErrorEnvelope {
  code: NimiStandardShellErrorCode;
  reasonCode: string;
  actionHint: string;
  source: NimiStandardShellErrorSource;
  details?: Record<string, unknown>;
}

export class NimiStandardShellCapabilityError extends Error {
  readonly envelope: NimiStandardShellErrorEnvelope;

  constructor(envelope: NimiStandardShellErrorEnvelope) {
    super(`${envelope.code}: ${envelope.reasonCode}`);
    this.name = 'NimiStandardShellCapabilityError';
    this.envelope = envelope;
  }
}

export function createNimiStandardShellError(
  input: NimiStandardShellErrorEnvelope,
): NimiStandardShellCapabilityError {
  return new NimiStandardShellCapabilityError(input);
}

export function isNimiStandardShellErrorCode(value: unknown): value is NimiStandardShellErrorCode {
  return typeof value === 'string' && NIMI_STANDARD_SHELL_ERROR_CODES.includes(value as NimiStandardShellErrorCode);
}

export function isNimiStandardShellErrorEnvelope(value: unknown): value is NimiStandardShellErrorEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isNimiStandardShellErrorCode(record.code)
    && typeof record.reasonCode === 'string'
    && record.reasonCode.length > 0
    && typeof record.actionHint === 'string'
    && record.actionHint.length > 0
    && typeof record.source === 'string'
    && NIMI_STANDARD_SHELL_ERROR_SOURCES.has(record.source)
    && (record.details === undefined || (
      Boolean(record.details)
      && typeof record.details === 'object'
      && !Array.isArray(record.details)
    ))
  );
}
