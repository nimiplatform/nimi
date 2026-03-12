export type AsRecordOptions = {
  allowArray?: boolean;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function asRecord(
  value: unknown,
  options?: AsRecordOptions,
): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (!options?.allowArray && Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
