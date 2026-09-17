import { desktopSimulatorBehavior } from './behavior.js';
import { createDesktopSimulatorBindings } from './bindings.js';
import type { DesktopSimulatorPrepareContext } from './protocol.js';

export const desktopSimulatorAdapterFactory = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'desktop',
  behavior: desktopSimulatorBehavior,
  create() {
    let phase: 'created' | 'prepared' | 'active' | 'inactive' | 'disposed' = 'created';
    return {
      prepare(context: DesktopSimulatorPrepareContext) {
        if (phase !== 'created') throw new Error('DESKTOP_SIMULATOR_ADAPTER_PREPARE_ORDER');
        phase = 'prepared';
        return createDesktopSimulatorBindings(context);
      },
      activate() {
        if (phase !== 'prepared' && phase !== 'inactive') {
          throw new Error('DESKTOP_SIMULATOR_ADAPTER_ACTIVATE_ORDER');
        }
        phase = 'active';
      },
      deactivate() {
        if (phase !== 'active') throw new Error('DESKTOP_SIMULATOR_ADAPTER_DEACTIVATE_ORDER');
        phase = 'inactive';
      },
      dispose() {
        if (phase === 'disposed') return;
        phase = 'disposed';
      },
    };
  },
} as const;
