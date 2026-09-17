import { zhiyuSimulatorBehavior } from './behavior.js';
import { createZhiyuSimulatorBindings } from './bindings.js';
import type { ZhiyuSimulatorPrepareContext } from './protocol.js';

export const zhiyuSimulatorAdapterFactory = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'zhiyu',
  behavior: zhiyuSimulatorBehavior,
  create() {
    let phase: 'created' | 'prepared' | 'active' | 'inactive' | 'disposed' = 'created';
    return {
      prepare(context: ZhiyuSimulatorPrepareContext) {
        if (phase !== 'created') throw new Error('ZHIYU_SIMULATOR_ADAPTER_PREPARE_ORDER');
        phase = 'prepared';
        return createZhiyuSimulatorBindings(context);
      },
      activate() {
        if (phase !== 'prepared' && phase !== 'inactive') throw new Error('ZHIYU_SIMULATOR_ADAPTER_ACTIVATE_ORDER');
        phase = 'active';
      },
      deactivate() {
        if (phase !== 'active') throw new Error('ZHIYU_SIMULATOR_ADAPTER_DEACTIVATE_ORDER');
        phase = 'inactive';
      },
      dispose() {
        if (phase === 'disposed') return;
        phase = 'disposed';
      },
    };
  },
} as const;
