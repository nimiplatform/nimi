export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export function parseOptionalJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}
