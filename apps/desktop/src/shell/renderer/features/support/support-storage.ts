/**
 * Local persistence for the `Support` surface (`D-SUP-001`).
 *
 * Only the last-selected sub-area is persisted — a pure UI convenience. The
 * Support surface itself never derives product truth from this value; every
 * sub-area reads its own typed projection on mount.
 */

import { resolveSupportSection, type SupportSectionId } from './support-sections.js';

export const SUPPORT_SELECTED_STORAGE_KEY = 'nimi.support.selected';

/** Read the persisted Support sub-area, falling back to `repair`. */
export function loadStoredSupportSection(): SupportSectionId {
  try {
    return resolveSupportSection(localStorage.getItem(SUPPORT_SELECTED_STORAGE_KEY));
  } catch {
    return 'repair';
  }
}

/** Persist the active Support sub-area. */
export function persistStoredSupportSection(section: SupportSectionId): void {
  try {
    localStorage.setItem(SUPPORT_SELECTED_STORAGE_KEY, section);
  } catch {
    // localStorage is best-effort; a write failure must never break the surface.
  }
}
