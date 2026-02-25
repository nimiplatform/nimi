export async function parseJsonObject(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
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
