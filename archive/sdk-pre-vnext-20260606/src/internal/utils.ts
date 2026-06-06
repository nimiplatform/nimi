export type AsRecordOptions = {
  allowArray?: boolean;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && (!Array.isArray(value));
}

export function asRecord(
  value: unknown,
  options?: AsRecordOptions,
): JsonObject {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (!options?.allowArray && Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

export function readString(record: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function resolveStreamUsage<T>(
  streamedUsage: T | null | undefined,
  completedUsage: T | null | undefined,
): T | undefined {
  return streamedUsage ?? completedUsage ?? undefined;
}
