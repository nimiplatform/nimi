/**
 * Stable identity fallback. Apps must not inspect app-local files for icons;
 * the Runtime-projected display name is already owner data.
 */
export function deriveIconGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toLocaleUpperCase();
}
