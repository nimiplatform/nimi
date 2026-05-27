export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
