/**
 * Forge shared formatting utilities.
 *
 * Extracted from 10+ page files that each had their own copy of formatDate.
 */

export function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
