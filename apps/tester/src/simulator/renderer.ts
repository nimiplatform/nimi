import { testerCanonicalRendererFactory } from '../renderer/factory.js';

export const testerSimulatorRenderer = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'tester',
  factory: testerCanonicalRendererFactory,
} as const;
