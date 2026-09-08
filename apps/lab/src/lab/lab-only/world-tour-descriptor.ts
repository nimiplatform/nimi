export type LabWorldTourCapabilityId = 'world.generate';

export const labWorldTourDescriptor = Object.freeze({
  id: 'world.generate', label: 'World Tour', labelKey: 'Capabilities.worldGenerate.label', group: 'world',
  section: 'world',
  summary: 'Standalone Electron viewer over an existing App-private world fixture.',
  summaryKey: 'Capabilities.worldGenerate.summary',
  surface: 'public App storage and an app-owned Electron viewer window',
  execution: 'standalone-electron',
} as const);
