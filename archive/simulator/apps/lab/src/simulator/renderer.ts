import { labCanonicalRendererFactory } from '../renderer/factory.js';

export const labSimulatorRenderer = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'lab',
  factory: labCanonicalRendererFactory,
} as const;
