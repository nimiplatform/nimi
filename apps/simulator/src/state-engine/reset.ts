/**
 * Two-phase scenario reset: synchronous old-epoch linearization inside the
 * drain, asynchronous ordered cleanup outside it, and synchronous new-epoch
 * reconstruction with ordered settlement.
 *
 * Authority: P-SIM-013; tables/simulator-state-engine-policy.yaml
 * `scenario_reset`; simulator-protocol.md §11.8.
 */

import {
  assertJsonValue,
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from './json-value.ts';
import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorError,
} from './errors.ts';
import { decodeSimulatorSeed, simulatorRandomToSnapshot } from './random.ts';
import { createLogicalClock } from './clock.ts';
import { createAsyncReservationPump } from './reservations.ts';
import { createStreamRegistry } from './streams.ts';
import {
  createEpochAllocators,
} from './ids.ts';
import type {
  SimulatorModuleCatalogDeclaration,
  SimulatorSnapshotPartitions,
} from './types.ts';
import {
  SimulatorIntegrityAbort,
  freezeInstancePresentation,
  type QueuedOperation,
  type SimulatorResetTerminalSettlement,
} from './engine-types.ts';
import {
  freezeCommittedState,
  flushSettlements,
  recordSettlement,
  type EngineContext,
} from './engine-context.ts';

export function beginResetLinearization(context: EngineContext, operation: QueuedOperation): void {
  const oldEpoch = context.epoch;
  if (context.epoch >= Number.MAX_SAFE_INTEGER) {
    throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  context.phase = 'resetting';
  context.wiring.onResetLinearization(oldEpoch);
  context.epoch += 1;
  context.allocators = createEpochAllocators();
  // Synchronous linearization: close admission, invalidate old tokens,
  // detach the accepted tail in operation-sequence order, end the old drain.
  context.hooks.invalidateEpoch?.(oldEpoch, context.epoch);
  const detachedTail = context.queue;
  context.queue = [];
  context.resetContext = { operation, oldEpoch, detachedTail };
  // The barrier's first cancellation/cleanup instruction must execute only
  // after the synchronous FIFO drain has returned and flushed old-epoch
  // settlements. Calling an async function directly would execute its prefix
  // inside the drain up to the first await.
  void Promise.resolve().then(() => runResetBarrier(context));
}

export async function runResetBarrier(context: EngineContext): Promise<void> {
  const resetContext = context.resetContext;
  if (!resetContext || context.phase !== 'resetting') return;
  const terminalSettlements: SimulatorResetTerminalSettlement[] = [];
  context.resetTerminalCapture = terminalSettlements;
  const recordTerminal = (kind: 'stream' | 'reservation' | 'readiness' | 'lifecycle', sequence: number, settle: () => void): void => {
    terminalSettlements.push({ kind, sequence, settle });
  };
  let cleanupError: unknown = null;
  try {
    // 1. Stream terminal cancellation by stream allocation sequence.
    context.streams.cancelAllForReset();
    // 2. Jobs and async reservations by allocation sequence.
    for (const job of context.clock.pendingJobs()) context.clock.cancel(job.jobId);
    for (const reservation of context.pump.cancelAll('reset')) {
      context.replayInputs.push({
        kind: 'reservation-terminal',
        reservation: {
          reservationId: reservation.reservationId,
          epoch: reservation.epoch,
          allocationSequence: reservation.allocationSequence,
          resolution: 'cancelled',
          outcome: null,
          cancelReason: 'reset',
        },
      });
    }
    // 3. Instances disposed in reverse creation order by the host.
    const instances = Object.entries(context.committed.snapshot.instances)
      .map(([instanceId, instance]) => freezeInstancePresentation(instanceId, instance))
      .sort((left, right) => right.creationSequence - left.creationSequence);
    await (context.hooks.disposeInstancesForReset?.(instances) ?? Promise.resolve());
  } catch (error) {
    cleanupError = error;
  }
  if (context.resetContext !== resetContext || context.phase !== 'resetting') return;
  try {
    context.hooks.collectResetTerminalSettlements?.((kind, sequence, settle) => recordTerminal(kind, sequence, settle));
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError !== null) {
    settleBarrierFailure(context, resetContext, terminalSettlements);
    return;
  }

  // 4. Synchronous reconstruction at new-epoch revision 0.
  try {
    reconstructNewEpoch(context);
  } catch {
    settleBarrierFailure(context, resetContext, terminalSettlements);
    return;
  }
  if (context.resetContext !== resetContext || context.phase !== 'resetting') return;
  context.resetContext = null;
  context.resetTerminalCapture = null;

  // 5. Ordered settlement: reset result, detached tail, protocol terminals.
  recordSettlement(context, resetContext.operation.sequence, resetContext.operation.settle, simulatorOk({ epoch: context.epoch, revision: 0 }));
  for (const entry of resetContext.detachedTail) {
    recordSettlement(context, entry.sequence, entry.settle, simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', {
      moduleId: entry.issuer.moduleId, instanceId: entry.issuer.instanceId, operationId: entry.operationId,
    })));
  }
  flushSettlements(context);
  flushTerminalSettlements(terminalSettlements);
  context.phase = 'open';
}

function settleBarrierFailure(
  context: EngineContext,
  resetContext: { operation: QueuedOperation; detachedTail: QueuedOperation[] },
  terminalSettlements: SimulatorResetTerminalSettlement[],
): void {
  if (context.resetContext !== resetContext || context.phase !== 'resetting') return;
  // Barrier failure: reset and detached tail fail; admission never reopens.
  context.resetContext = null;
  context.phase = 'terminal';
  context.resetTerminalCapture = null;
  context.terminalError = simulatorError('SIMULATOR_INTEGRITY_FAILURE');
  recordSettlement(context, resetContext.operation.sequence, resetContext.operation.settle, simulatorFail(context.terminalError));
  for (const entry of resetContext.detachedTail) {
    recordSettlement(context, entry.sequence, entry.settle, simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: entry.issuer.moduleId, instanceId: entry.issuer.instanceId, operationId: entry.operationId,
    })));
  }
  flushSettlements(context);
  flushTerminalSettlements(terminalSettlements);
  context.hooks.onSessionTerminal?.(context.terminalError);
}

/**
 * Transfers an in-flight reset barrier to the session-terminal owner. The
 * barrier continuation observes the cleared identity and can never reconstruct
 * state or reopen admission after this point.
 */
export function settleActiveResetForTerminal(
  context: EngineContext,
  error: SimulatorError,
): boolean {
  const resetContext = context.resetContext;
  if (!resetContext) return false;
  const terminalSettlements = context.resetTerminalCapture ?? [];
  context.resetTerminalCapture = terminalSettlements;
  try {
    context.hooks.collectResetTerminalSettlements?.((kind, sequence, settle) => {
      terminalSettlements.push({ kind, sequence, settle });
    });
  } catch {
    // The session is already terminal. Settlements already captured remain
    // authoritative; the host hook cannot reopen or replace this failure.
  }
  context.resetContext = null;
  context.resetTerminalCapture = null;
  recordSettlement(context, resetContext.operation.sequence, resetContext.operation.settle, simulatorFail(error));
  for (const entry of resetContext.detachedTail) {
    recordSettlement(context, entry.sequence, entry.settle, simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: entry.issuer.moduleId,
      instanceId: entry.issuer.instanceId,
      operationId: entry.operationId,
    })));
  }
  flushSettlements(context);
  flushTerminalSettlements(terminalSettlements);
  return true;
}

export function reconstructNewEpoch(context: EngineContext): void {
  if (context.phase !== 'resetting') throw new Error('SIMULATOR_RESET_NOT_ACTIVE');
  const { scenario } = context;
  const freshModules: Record<string, JsonValue> = {};
  const ordered = [...context.loadedModules]
    .map((moduleId) => context.moduleCatalogs.get(moduleId))
    .filter((declaration): declaration is SimulatorModuleCatalogDeclaration => Boolean(declaration))
    .sort((left, right) => left.orderingKey - right.orderingKey);
  const basePartitions: SimulatorSnapshotPartitions = {
    scenario: scenario.scenarioState,
    ecosystem: scenario.ecosystemState,
    shell: scenario.shellState,
    instances: {},
    modules: {},
  };
  for (const declaration of ordered) {
    const behavior = context.moduleBehaviors.get(declaration.moduleId);
    if (!behavior) throw new Error('SIMULATOR_LOADED_BEHAVIOR_MISSING');
    const shared = declaration.selectSharedProjection
      ? freezeJsonValue(assertJsonValue(declaration.selectSharedProjection(basePartitions)))
      : scenario.ecosystemState;
    const initial = behavior.initialState({
      scenarioId: scenario.scenarioId,
      scenarioRevision: scenario.scenarioRevision,
      moduleData: declaration.moduleData,
      sharedProjection: shared,
    });
    if (context.phase !== 'resetting') throw new Error('SIMULATOR_RESET_TERMINATED');
    freshModules[declaration.moduleId] = freezeJsonValue(assertJsonValue(initial));
  }
  if (context.phase !== 'resetting') throw new Error('SIMULATOR_RESET_TERMINATED');
  context.committed = freezeCommittedState({
    snapshot: {
      scenario: freezeJsonValue(cloneJsonValue(scenario.scenarioState)),
      ecosystem: freezeJsonValue(cloneJsonValue(scenario.ecosystemState)),
      shell: freezeJsonValue(cloneJsonValue(scenario.shellState)),
      instances: {},
      modules: freshModules,
    },
    revision: 0,
    random: simulatorRandomToSnapshot(decodeSimulatorSeed(scenario.seed)),
    logicalTime: scenario.initialLogicalTime,
  });
  // Clock, stream, and reservation registries are epoch-owned mutable state.
  // Reusing their cancelled old-epoch ledgers would leak logical time and
  // allocation order into the reconstructed scenario even though canonical
  // IDs restart at one.
  context.clock = createLogicalClock(scenario.initialLogicalTime);
  context.streams = createStreamRegistry({
    onItem: context.wiring.onStreamItem,
    onTerminal: context.wiring.onStreamTerminal,
  });
  context.pump = createAsyncReservationPump({
    onRelease: context.wiring.onReservationRelease,
  });
  context.streamHandles.clear();
  context.reservationResultSinks.clear();
  context.eventSubscribers = [];
  context.prepareWindows = new Map();
  context.replayReservationHandles.clear();
}

export function flushTerminalSettlements(settlementsToFlush: readonly SimulatorResetTerminalSettlement[]): void {
  const order = { stream: 0, reservation: 1, readiness: 2, lifecycle: 3 } as const;
  [...settlementsToFlush]
    .sort((left, right) => (order[left.kind] - order[right.kind]) || (left.sequence - right.sequence))
    .forEach((entry) => entry.settle());
}
