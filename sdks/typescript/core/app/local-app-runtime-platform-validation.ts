import { createNimiError } from '../../types';

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'account',
  'accountgeneration',
  'accountid',
  'appaccessdomainid',
  'appoperationid',
  'accesstoken',
  'authorization',
  'bearer',
  'binding',
  'bindingid',
  'classification',
  'connectorgrant',
  'connectorgrantid',
  'credential',
  'custody',
  'custodymaterial',
  'declarationgeneration',
  'domainid',
  'endpoint',
  'generation',
  'grantid',
  'launchid',
  'localappprincipalid',
  'localapprecordid',
  'operationid',
  'peerproof',
  'processid',
  'providercredential',
  'refreshtoken',
  'registeredappsubject',
  'registrationhandle',
  'scopedbinding',
  'sessionid',
  'sessionproof',
  'snapshot',
  'snapshotid',
  'sourcegeneration',
  'subject',
  'token',
  'trustclass',
]);

const FORBIDDEN_AI_CONFIG_IDENTITY_FIELDS = new Set([
  'assetId',
  'assetPath',
  'componentId',
  'componentKind',
  'connectorId',
  'durableTargetRef',
  'encoderModelId',
  'entryOverrides',
  'filePath',
  'fileName',
  'localAssetId',
  'localProfileRef',
  'logicalModelId',
  'model',
  'modelId',
  'path',
  'profileBindingId',
  'profileEntries',
  'profileOverrides',
  'provider',
  'qwenModelId',
  'role',
  'sourceFileName',
  'targetRef',
  'vaeModelId',
  'workflowBindingId',
].map((value) => normalizeFieldName(value)));

export function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  return decimalCursor(value, 'cursor');
}

export function decimalCursor(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    localAppProjectionError(field);
  }
  return value;
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    localAppProjectionError(field);
  }
  return value;
}

export function canonicalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value) localAppProjectionError(field);
  return value;
}

export function projectTimestamp(
  value: unknown,
  field: string,
): { readonly seconds: string; readonly nanos: number } | undefined {
  if (value === null || value === undefined) return undefined;
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['seconds', 'nanos'], field);
  const seconds = typeof record.seconds === 'string' && /^-?(?:0|[1-9]\d*)$/u.test(record.seconds)
    ? record.seconds
    : undefined;
  const nanos = record.nanos;
  if (!seconds || typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos > 999_999_999) {
    localAppProjectionError(field);
  }
  return { seconds, nanos };
}

export function assertExactMethodNamespace(
  value: unknown,
  methods: readonly string[],
  namespace: string,
): void {
  const record = asRecord(value);
  if (!record || !sameKeys(record, methods) || methods.some((method) => typeof record[method] !== 'function')) {
    localAppError(
      `Host-injected local-app standardShell ${namespace} namespace is invalid.`,
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
}

export function assertExactProjectionKeys(
  value: unknown,
  expected: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record || !sameKeys(record, expected)) localAppProjectionError(field);
}

function sameKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function assertSafeProjection(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') localAppProjectionError('unsafe value');
  if (seen.has(value)) localAppProjectionError('cyclic value');
  seen.add(value);
  if (value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeProjection(entry, seen);
    return;
  }
  const record = asRecord(value);
  if (!record) localAppProjectionError('unsafe object');
  for (const [key, entry] of Object.entries(record)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(normalizeFieldName(key))) {
      localAppProjectionError(`forbidden ${key}`);
    }
    assertSafeProjection(entry, seen);
  }
}

export function assertNoAIConfigPrivateIdentity(
  value: unknown,
  field: string,
  input: boolean,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAIConfigPrivateIdentity(entry, `${field}[${index}]`, input, seen));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (FORBIDDEN_AI_CONFIG_IDENTITY_FIELDS.has(normalizeFieldName(key))) {
      if (input) {
        localAppError(
          `${field} cannot carry Runtime-private identity ${key}.`,
          'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
          'remove_runtime_private_ai_config_identity',
        );
      }
      localAppProjectionError(`${field}.${key}`);
    }
    assertNoAIConfigPrivateIdentity(child, `${field}.${key}`, input, seen);
  }
}

export function assertNoAuthorityMaterial(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (value instanceof Uint8Array) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') localAppProjectionError('symbol input field');
    if (FORBIDDEN_AUTHORITY_FIELDS.has(normalizeFieldName(key))) {
      localAppError(
        `Local-app operation input cannot carry ${key}.`,
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
        'remove_app_supplied_authority_material',
      );
    }
    assertNoAuthorityMaterial((value as Record<string, unknown>)[key], seen);
  }
}

export function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

export function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record || Object.keys(record).some((key) => !allowed.includes(key))) {
    localAppError(`${label} contains unsupported fields.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'remove_unsupported_fields');
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

export function requireText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized || normalized !== value) {
    localAppError(`Local-app carrier requires canonical ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', `provide_${field}`);
  }
  return normalized;
}

export function projectionText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized || normalized !== value) localAppProjectionError(field);
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function localAppProjectionError(field: string): never {
  return localAppError(
    `Host-injected local-app carrier returned an invalid ${field} projection.`,
    'SDK_LOCAL_APP_PROJECTION_INVALID',
    'repair_host_injected_standard_shell',
  );
}

export function localAppError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({ message, reasonCode, actionHint, source: 'sdk' });
}
