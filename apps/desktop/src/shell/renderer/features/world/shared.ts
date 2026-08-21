export function normalizeWorldType(type: string | null | undefined): string {
  return String(type || '').trim().toUpperCase();
}

export function isMainWorldType(type: string | null | undefined): boolean {
  const normalized = normalizeWorldType(type);
  return normalized === 'OASIS'
    || normalized === 'MAIN'
    || normalized === 'MAIN_WORLD'
    || normalized === 'PRIMARY'
    || normalized === 'ROOT';
}
