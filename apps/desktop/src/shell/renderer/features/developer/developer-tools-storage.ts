/**
 * Local persistence for the `Developer Tools` surface (`D-DEV-001`).
 *
 * Only the last-selected sub-area is persisted — a pure UI convenience. The
 * surface never derives product truth from this value; reachability is always
 * re-derived from admitted Developer Mode (`developer-mode.ts`).
 */

import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import {
  resolveDeveloperToolsSection,
  type DeveloperToolsSectionId,
} from './developer-tools-sections.js';

export const DEVELOPER_TOOLS_SELECTED_STORAGE_KEY = 'nimi.developer-tools.selected';

/** Read the persisted Developer Tools sub-area, falling back to diagnostics. */
export function loadStoredDeveloperToolsSection(): DeveloperToolsSectionId {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), DEVELOPER_TOOLS_SELECTED_STORAGE_KEY);
  return resolveDeveloperToolsSection(result.state === 'ready' ? result.value : null);
}

/** Persist the active Developer Tools sub-area. */
export function persistStoredDeveloperToolsSection(section: DeveloperToolsSectionId): void {
  writeStorageTextTo(resolveBrowserStorage('local'), DEVELOPER_TOOLS_SELECTED_STORAGE_KEY, section);
}
