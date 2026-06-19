export function joinParts(parts: Array<string | null | undefined>): string | null {
  const values = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return values.length ? values.join(' / ') : null;
}
