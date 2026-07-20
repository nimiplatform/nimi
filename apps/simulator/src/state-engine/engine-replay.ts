/** State Engine replay-ledger construction and terminal application. */

import { canonicalizeJson, type JsonValue } from './json-value.ts';
import { sha256HexOfText } from './sha256.ts';
import { simulatorError } from './errors.ts';
import {
  SimulatorIntegrityAbort,
  type SimulatorReplayRecord,
} from './engine-types.ts';
import { digestCommitted, digestEvents, type EngineContext } from './engine-context.ts';
import { replayStreamMethodIdentity } from './replay-identity.ts';

export function buildEngineReplayRecord(context: EngineContext): SimulatorReplayRecord {
  if (
    context.replayExternalOperations.size > 0
    || context.pump.ledger().some((entry) => entry.state === 'open' || entry.state === 'buffered')
    || context.streams.records().some((entry) => entry.status !== 'terminal')
  ) throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  return {
    protocolRevision: 1,
    scenarioId: context.scenario.scenarioId,
    scenarioRevision: context.scenario.scenarioRevision,
    seed: context.scenario.seed,
    initialLogicalTime: context.scenario.initialLogicalTime,
    moduleIds: [...context.moduleCatalogs.keys()],
    streamMethods: [...context.streamMethods.values()].map(replayStreamMethodIdentity),
    inputs: context.replayInputs.slice(),
    operationSettlements: context.replayOperationSettlements
      .slice()
      .sort((left, right) => left.acceptanceOrder - right.acceptanceOrder),
    expected: {
      epoch: context.epoch,
      revision: context.committed.revision,
      logicalTime: context.committed.logicalTime,
      random: context.committed.random,
      stateDigest: digestCommitted(context),
      eventDigest: digestEvents(context),
    },
  };
}

export function engineReplayRecordDigest(record: SimulatorReplayRecord): string {
  return `sha256:${sha256HexOfText(canonicalizeJson(record as unknown as JsonValue))}`;
}

export function applyEngineReplayReservationTerminal(
  context: EngineContext,
  reservationId: string,
  resolution: 'settled' | 'cancelled',
  outcome: JsonValue | null,
  cancelReason: 'caller' | 'dispose' | 'reset' | null,
): void {
  const handle = context.replayReservationHandles.get(reservationId);
  if (!handle) throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  let applied;
  if (resolution === 'settled') {
    if (cancelReason !== null || outcome === null) {
      throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    }
    applied = handle.settle(outcome);
  } else {
    if (outcome !== null || cancelReason === null) {
      throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    }
    applied = handle.cancel(cancelReason);
  }
  if (!applied.ok || !('accepted' in applied.value ? applied.value.accepted : applied.value.cancelled)) {
    throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  const matched = /^(\d+):async:(\d+)$/u.exec(reservationId);
  if (!matched) throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  context.replayInputs.push({
    kind: 'reservation-terminal',
    reservation: {
      reservationId,
      epoch: Number(matched[1]),
      allocationSequence: Number(matched[2]),
      resolution,
      outcome,
      cancelReason,
    },
  });
}
