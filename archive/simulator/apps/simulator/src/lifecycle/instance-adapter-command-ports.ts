import { adapterCommandAdmissionError } from '../state-engine/caller-admission.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import { simulatorFail } from '../state-engine/errors.ts';
import { simulatorAdapterPortError } from './adapter-port-state.ts';
import type { SimulatorAdapterPrepareContext } from './instance-host-contract.ts';
import type { SimulatorInstanceRecord } from './lifecycle-settlements.ts';

type AdapterCommandPorts = Pick<SimulatorAdapterPrepareContext, 'commands' | 'interactions'>;

/** Builds only the instance-scoped command ports; lifecycle and event custody stay in the host. */
export function createSimulatorAdapterCommandPorts(
  engine: SimulatorStateEngine,
  record: SimulatorInstanceRecord,
): AdapterCommandPorts {
  const issuer = {
    kind: 'instance' as const,
    moduleId: record.moduleId,
    instanceId: record.instanceId,
  };
  return {
    commands: {
      invoke(type, payload) {
        const error = adapterCommandAdmissionError(
          type,
          record.moduleId,
          record.instanceId,
          simulatorAdapterPortError(engine, record),
        );
        if (error) return Promise.resolve(simulatorFail(error));
        return engine.acceptCommand(type, payload, issuer);
      },
    },
    interactions: {
      emit(input) {
        const error = simulatorAdapterPortError(engine, record);
        if (error) return Promise.resolve(simulatorFail(error));
        return engine.acceptCommand('simulator.interaction.emit', {
          protocol: input.protocol,
          interactionId: input.interactionId,
          source: { moduleId: record.moduleId, instanceId: record.instanceId },
          targets: input.targets,
          type: input.type,
          payload: input.payload,
        }, issuer);
      },
    },
  };
}
