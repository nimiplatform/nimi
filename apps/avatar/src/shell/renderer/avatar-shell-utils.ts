export function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function shortenId(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 'Unavailable';
  }
  return normalized.length > 16
    ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
    : normalized;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAbortError(): Error {
  const error = new Error('Foreground voice request aborted.');
  error.name = 'AbortError';
  return error;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, form'));
}
