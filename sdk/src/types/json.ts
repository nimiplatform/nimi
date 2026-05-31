export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export async function parseJsonObjectResponse(response: Response): Promise<JsonObject | null> {
  try {
    const text = await response.text();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function tryParseJsonLike<T>(value: T): T {
  if (typeof value !== 'string') {
    return value;
  }
  const text = value.trim();
  if (!text) {
    return value;
  }
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
