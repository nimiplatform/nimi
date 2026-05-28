export function buildLocalId(prefix: string) {
  return `local:${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function formatProviderError(error: unknown) {
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message?: unknown }).message || '');
  }
  if (error instanceof Error) return error.message;
  return String(error || '');
}
