export type LabWorldTourCapabilityId = 'world.generate';

export const labWorldTourDescriptor = Object.freeze({
  id: 'world.generate', label: 'World Tour', labelKey: 'Capabilities.worldGenerate.label', group: 'world',
  section: 'world',
  summary: 'Generate a world through Runtime and explore its saved 3D assets.',
  summaryKey: 'Capabilities.worldGenerate.summary',
  surface: 'Runtime Scenario Jobs, public App storage, and an Electron 3D viewer',
  execution: 'runtime-sdk',
  capabilityContract: 'world.generate',
} as const);
