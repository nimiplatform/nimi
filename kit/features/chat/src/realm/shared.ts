export function normalizeText(value: string): string {
  return String(value || '').trim();
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeChatId(chatId: string): string {
  return String(chatId || '').trim();
}

export function normalizeLimit(limit: number, fallback: number, max: number): number {
  return Number.isFinite(limit) ? Math.min(max, Math.max(1, Math.floor(limit))) : fallback;
}

export function normalizeDateString(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}
