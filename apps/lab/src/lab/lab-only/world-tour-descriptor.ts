export type LabWorldTourCapabilityId = 'world.generate';

export const labWorldTourDescriptor = Object.freeze({
  id: 'world.generate', label: 'World Tour', labelKey: 'Capabilities.worldGenerate.label', group: 'world',
  section: 'world',
  summary: 'Standalone Tauri viewer launch via app-owned open_world_tour_window command.',
  summaryKey: 'Capabilities.worldGenerate.summary',
  surface: 'app-owned tauri: resolve_world_tour_fixture + open_world_tour_window',
  execution: 'standalone-tauri',
} as const);
