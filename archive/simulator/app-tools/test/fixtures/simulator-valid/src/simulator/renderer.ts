import { sampleCanonicalRendererFactory } from '../renderer/factory';

export const sampleSimulatorRenderer = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'sample-app',
  factory: sampleCanonicalRendererFactory,
} as const;
