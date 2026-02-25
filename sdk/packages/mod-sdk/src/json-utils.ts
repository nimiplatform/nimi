export function asRecord(
  value: unknown,
  options?: { allowArray?: boolean },
): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (!options?.allowArray && Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function safeParseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(String(text || '')) as T;
  } catch {
    return fallback;
  }
}

export function safeParseObject(text: string): Record<string, unknown> {
  const parsed = safeParseJson<unknown>(String(text || '{}'), {});
  return asRecord(parsed);
}

export function safeParseArray(text: string): unknown[] {
  const parsed = safeParseJson<unknown>(String(text || '[]'), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp01(value: unknown, fallback = 0.5): number {
  const numeric = toFiniteNumber(value, fallback);
  return Math.max(0, Math.min(1, numeric));
}
