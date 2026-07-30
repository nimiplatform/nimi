function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalizes client-rendered Avatar preview surfaces to same-origin paths or
 * same-origin blob URLs. External, protocol-relative, and malformed refs fail closed.
 */
export function normalizeAvatarControlledPreviewSurfaceRef(value: unknown): string {
  const text = normalizeText(value);
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) {
    return text;
  }
  if (!text.startsWith('blob:')) return '';
  const currentOrigin = normalizeText(globalThis.location?.origin);
  if (!currentOrigin || currentOrigin === 'null') return '';
  try {
    return new URL(text.slice('blob:'.length)).origin === currentOrigin ? text : '';
  } catch {
    return '';
  }
}

export function isAvatarControlledPreviewSurfaceRef(value: unknown): boolean {
  return Boolean(normalizeAvatarControlledPreviewSurfaceRef(value));
}
