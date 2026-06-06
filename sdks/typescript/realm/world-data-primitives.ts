import {
  createNimiError,
  type JsonObject,
} from '../types';

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readString(record: JsonObject, keys: readonly string[]): string {
  for (const key of keys) {
    const value = readStringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => readStringValue(item))
      .filter(Boolean)
    : [];
}

export function requireWorldError(reasonCode: string, message: string, actionHint: string, details?: JsonObject): never {
  throw createNimiError({
    message,
    code: reasonCode,
    reasonCode,
    actionHint,
    source: 'realm',
    details,
  });
}

export function requireRecord(value: unknown, reasonCode: string): JsonObject {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    requireWorldError(reasonCode, 'Realm world response is not a record.', 'check_realm_world_response');
  }
  return record;
}

export function requireRecordArray(value: unknown, reasonCode: string): JsonObject[] {
  if (!Array.isArray(value) || value.some((item) => Object.keys(asRecord(item)).length === 0)) {
    requireWorldError(reasonCode, 'Realm world response is not a record array.', 'check_realm_world_response');
  }
  return value.map((item) => asRecord(item));
}
