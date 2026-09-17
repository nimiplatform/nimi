import { labSimulatorBehavior } from './behavior.js';
import { createLabSimulatorBindings } from './bindings.js';
import type { LabSimulatorPrepareContext } from './protocol.js';

export const labSimulatorAdapterFactory = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'lab',
  behavior: labSimulatorBehavior,
  create() {
    let phase: 'created' | 'prepared' | 'active' | 'inactive' | 'disposed' = 'created';
    return {
      prepare(context: LabSimulatorPrepareContext) {
        if (phase !== 'created') throw new Error('LAB_SIMULATOR_ADAPTER_PREPARE_ORDER');
        phase = 'prepared';
        return createLabSimulatorBindings(context);
      },
      activate() {
        if (phase !== 'prepared' && phase !== 'inactive') throw new Error('LAB_SIMULATOR_ADAPTER_ACTIVATE_ORDER');
        phase = 'active';
      },
      deactivate() {
        if (phase !== 'active') throw new Error('LAB_SIMULATOR_ADAPTER_DEACTIVATE_ORDER');
        phase = 'inactive';
      },
      dispose() {
        if (phase === 'disposed') return;
        phase = 'disposed';
      },
    };
  },
} as const;
