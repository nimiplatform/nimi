export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export async function parseJsonObject(
  response: Response,
): Promise<JsonObject | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (isJsonObject(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function tryParseJsonLike<T>(value: T): T {
  if (typeof value !== 'string') {
    return value;
  }
  const text = value.trim();
  if (!text) return value;
  if (
    (text.startsWith('{') && text.endsWith('}'))
    || (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.parse(text) as T;
    } catch {
      return value;
    }
  }
  return value;
}
