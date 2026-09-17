/** Current-epoch/lifecycle admission shared by every captured Adapter port. */

import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import { simulatorError, type SimulatorError } from '../state-engine/errors.ts';
import type { SimulatorInstanceRecord } from './lifecycle-settlements.ts';

export function simulatorAdapterPortError(
  engine: SimulatorStateEngine,
  record: SimulatorInstanceRecord,
): SimulatorError | null {
  if (record.epoch !== engine.epoch) {
    return simulatorError('SIMULATOR_STALE_EPOCH', {
      moduleId: record.moduleId,
      instanceId: record.instanceId,
    });
  }
  if (!record.tokenValid || ['disposing', 'disposed', 'failed'].includes(record.phase)) {
    return simulatorError('SIMULATOR_INSTANCE_DISPOSED', {
      moduleId: record.moduleId,
      instanceId: record.instanceId,
    });
  }
  return null;
}

export function assertSimulatorAdapterPortCurrent(
  engine: SimulatorStateEngine,
  record: SimulatorInstanceRecord,
): void {
  const error = simulatorAdapterPortError(engine, record);
  if (error) throw new Error(error.code);
}
