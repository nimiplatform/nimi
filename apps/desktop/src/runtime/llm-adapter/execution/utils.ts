export function formatProviderError(error: unknown) {
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message?: unknown }).message || '');
  }
  if (error instanceof Error) return error.message;
  return String(error || '');
}
