import { zhiyuCanonicalRendererFactory } from '../renderer/factory.js';

export const zhiyuSimulatorRenderer = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'zhiyu',
  factory: zhiyuCanonicalRendererFactory,
} as const;
