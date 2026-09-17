import { desktopCanonicalRendererFactory } from '../shell/renderer/renderer/factory.js';

export const desktopSimulatorRenderer = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'desktop',
  factory: desktopCanonicalRendererFactory,
} as const;
