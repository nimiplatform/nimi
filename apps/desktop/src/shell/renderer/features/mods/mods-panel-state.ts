const MODS_PANEL_SECTION_STORAGE_KEY = 'nimi.desktop.mods.active-section';

export type ModsPanelSection = 'library' | 'marketplace';

export function loadStoredModsPanelSection(): ModsPanelSection {
  try {
    const raw = localStorage.getItem(MODS_PANEL_SECTION_STORAGE_KEY);
    return raw === 'marketplace' ? 'marketplace' : 'library';
  } catch {
    return 'library';
  }
}

export function persistStoredModsPanelSection(section: ModsPanelSection): void {
  try {
    localStorage.setItem(MODS_PANEL_SECTION_STORAGE_KEY, section);
  } catch {
    // ignore
  }
}
