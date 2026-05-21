/**
 * Local persistence for the `Developer Tools` surface (`D-DEV-001`).
 *
 * Only the last-selected sub-area is persisted — a pure UI convenience. The
 * surface never derives product truth from this value; reachability is always
 * re-derived from admitted Developer Mode (`developer-mode.ts`).
 */

import {
  resolveDeveloperToolsSection,
  type DeveloperToolsSectionId,
} from './developer-tools-sections.js';

export const DEVELOPER_TOOLS_SELECTED_STORAGE_KEY = 'nimi.developer-tools.selected';

/** Read the persisted Developer Tools sub-area, falling back to `mod-sources`. */
export function loadStoredDeveloperToolsSection(): DeveloperToolsSectionId {
  try {
    return resolveDeveloperToolsSection(
      localStorage.getItem(DEVELOPER_TOOLS_SELECTED_STORAGE_KEY),
    );
  } catch {
    return 'mod-sources';
  }
}

/** Persist the active Developer Tools sub-area. */
export function persistStoredDeveloperToolsSection(section: DeveloperToolsSectionId): void {
  try {
    localStorage.setItem(DEVELOPER_TOOLS_SELECTED_STORAGE_KEY, section);
  } catch {
    // localStorage is best-effort; a write failure must never break the surface.
  }
}
