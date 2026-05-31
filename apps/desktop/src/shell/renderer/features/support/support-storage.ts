/**
 * Local persistence for the `Support` surface (`D-SUP-001`).
 *
 * Only the last-selected sub-area is persisted — a pure UI convenience. The
 * Support surface itself never derives product truth from this value; every
 * sub-area reads its own typed projection on mount.
 */

import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { resolveSupportSection, type SupportSectionId } from './support-sections.js';

export const SUPPORT_SELECTED_STORAGE_KEY = 'nimi.support.selected';

/** Read the persisted Support sub-area, falling back to `repair`. */
export function loadStoredSupportSection(): SupportSectionId {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), SUPPORT_SELECTED_STORAGE_KEY);
  return resolveSupportSection(result.state === 'ready' ? result.value : null);
}

/** Persist the active Support sub-area. */
export function persistStoredSupportSection(section: SupportSectionId): void {
  writeStorageTextTo(resolveBrowserStorage('local'), SUPPORT_SELECTED_STORAGE_KEY, section);
}
