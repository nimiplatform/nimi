/**
 * Exactly-once public lifecycle settlement and reset-terminal ordering.
 * Kept separate from host orchestration so unresolved App promises cannot own
 * the completion of already accepted Simulator lifecycle operations.
 *
 * Authority: P-SIM-013/P-SIM-019; state-engine reset settlement order.
 */

import {
  simulatorError,
  simulatorFail,
  type SimulatorError,
  type SimulatorErrorCode,
  type SimulatorResult,
} from '../state-engine/errors.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorCleanupController } from './cleanup-registry.ts';
import type {
  SimulatorAdapterInstance,
  SimulatorHostPhase,
  SimulatorPreparedSurfaceHost,
} from './instance-host-contract.ts';
import type {
  SimulatorCanonicalInstance,
  SimulatorCanonicalRendererBindings,
} from './renderer-contract.ts';

export interface SimulatorInstanceRecord {
  readonly instanceId: string;
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortController: AbortController;
  readonly invalidated: Promise<void>;
  readonly resolveInvalidated: () => void;
  phase: SimulatorHostPhase;
  tokenValid: boolean;
  adapter: SimulatorAdapterInstance | null;
  canonical: SimulatorCanonicalInstance | null;
  surfaceHost: SimulatorPreparedSurfaceHost | null;
  readonly cleanup: SimulatorCleanupController;
  cleanupCompletion: Promise<boolean> | null;
  pendingLoad: Promise<void> | null;
  pendingPrepare: Promise<SimulatorCanonicalRendererBindings> | null;
  disposeStarted: boolean;
  disposeCompletion: Promise<void> | null;
  resolveDisposeCompletion: (() => void) | null;
  adapterDisposed: boolean;
  canonicalDisposed: boolean;
  surfaceUnmounted: boolean;
  failureDiagnostic: SimulatorError | null;
  disposeFailure: SimulatorError | null;
  intents: Promise<void>;
}

type LifecycleTerminalCode = Extract<SimulatorErrorCode,
  | 'SIMULATOR_STALE_EPOCH'
  | 'SIMULATOR_INSTANCE_DISPOSED'
  | 'SIMULATOR_INSTANCE_FAILED'
  | 'SIMULATOR_INTEGRITY_FAILURE'>;

export interface AcceptedLifecycleTerminal {
  readonly sequence: number;
  readonly epoch: number;
  readonly kind: 'open' | 'activate' | 'deactivate' | 'dispose';
  readonly moduleId: string | null;
  instanceId: string | null;
  settled: boolean;
  resetQueued: boolean;
  settleTerminal(error: SimulatorError): void;
}

export interface AcceptedLifecycle<TValue> {
  readonly terminal: AcceptedLifecycleTerminal;
  readonly promise: Promise<SimulatorResult<TValue>>;
  settle(result: SimulatorResult<TValue>): void;
}

export interface LifecycleSettlementLedger {
  accept<TValue>(
    kind: AcceptedLifecycleTerminal['kind'],
    epoch: number,
    moduleId: string | null,
    instanceId: string | null,
  ): AcceptedLifecycle<TValue>;
  error(terminal: AcceptedLifecycleTerminal, code: LifecycleTerminalCode): SimulatorError;
  queueReset(oldEpoch: number): void;
  settleInstance(
    instanceId: string,
    code: Exclude<LifecycleTerminalCode, 'SIMULATOR_STALE_EPOCH'>,
  ): void;
  settleSession(): void;
  invalidateRecord(
    record: SimulatorInstanceRecord,
    reason: 'dispose' | 'failure' | 'reset' | 'session',
  ): void;
  collectReset(record: (sequence: number, settle: () => void) => void): void;
}

export function resetOwnsRecordDisposal(
  engine: SimulatorStateEngine,
  record: SimulatorInstanceRecord,
): boolean {
  // Reset linearization owns old-epoch cleanup and terminal ordering. A
  // previously queued close must not reinterpret stale admission as session
  // corruption or race the reset cleanup barrier.
  return engine.phase === 'resetting' || record.epoch !== engine.epoch;
}

export function createLifecycleSettlementLedger(engine: SimulatorStateEngine): LifecycleSettlementLedger {
  const accepted = new Set<AcceptedLifecycleTerminal>();
  const resetSettlements: { readonly sequence: number; readonly settle: () => void }[] = [];
  let sequence = 0;

  const error = (terminal: AcceptedLifecycleTerminal, code: LifecycleTerminalCode): SimulatorError => (
    simulatorError(code, { moduleId: terminal.moduleId, instanceId: terminal.instanceId })
  );

  const ledger: LifecycleSettlementLedger = {
    accept<TValue>(
      kind: AcceptedLifecycleTerminal['kind'],
      epoch: number,
      moduleId: string | null,
      instanceId: string | null,
    ): AcceptedLifecycle<TValue> {
      sequence += 1;
      let resolvePromise: (result: SimulatorResult<TValue>) => void = () => undefined;
      const promise = new Promise<SimulatorResult<TValue>>((resolve) => { resolvePromise = resolve; });
      const terminal: AcceptedLifecycleTerminal = {
        sequence,
        epoch,
        kind,
        moduleId,
        instanceId,
        settled: false,
        resetQueued: false,
        settleTerminal(terminalError) {
          if (terminal.settled) return;
          terminal.settled = true;
          accepted.delete(terminal);
          resolvePromise(simulatorFail(terminalError));
        },
      };
      accepted.add(terminal);
      return {
        terminal,
        promise,
        settle(result) {
          if (terminal.settled || terminal.resetQueued) return;
          terminal.settled = true;
          accepted.delete(terminal);
          resolvePromise(result);
        },
      };
    },
    error,
    queueReset(oldEpoch) {
      for (const terminal of accepted) {
        if (terminal.settled || terminal.resetQueued || terminal.epoch !== oldEpoch) continue;
        terminal.resetQueued = true;
        resetSettlements.push({
          sequence: terminal.sequence,
          settle: () => terminal.settleTerminal(error(terminal, 'SIMULATOR_STALE_EPOCH')),
        });
      }
    },
    settleInstance(instanceId, code) {
      for (const terminal of accepted) {
        if (terminal.instanceId !== instanceId || terminal.resetQueued) continue;
        // A dispose request owns the invalidation that starts its cleanup; it
        // settles only from cleanup completion, reset, or session failure.
        if (terminal.kind === 'dispose' && code === 'SIMULATOR_INSTANCE_DISPOSED') continue;
        // An open failure is completed by the open pipeline only after its
        // attributable cleanup reaches a terminal postcondition.
        if (code === 'SIMULATOR_INSTANCE_FAILED' && terminal.kind === 'open') continue;
        terminal.settleTerminal(error(terminal, code));
      }
    },
    settleSession() {
      for (const terminal of accepted) {
        if (terminal.resetQueued) continue;
        terminal.settleTerminal(error(terminal, 'SIMULATOR_INTEGRITY_FAILURE'));
      }
    },
    invalidateRecord(record, reason) {
      if (reason === 'dispose') ledger.settleInstance(record.instanceId, 'SIMULATOR_INSTANCE_DISPOSED');
      else if (reason === 'failure') ledger.settleInstance(record.instanceId, 'SIMULATOR_INSTANCE_FAILED');
      else if (reason === 'session') ledger.settleInstance(record.instanceId, 'SIMULATOR_INTEGRITY_FAILURE');
      if (!record.tokenValid) return;
      record.tokenValid = false;
      // Cancel owned resources before abort listeners can synchronously use a
      // captured handle. Reset owns its allocation-ordered barrier.
      if (reason !== 'reset') {
        engine.cancelStreamsForInstance(record.instanceId);
        engine.cancelAsyncReservationsForInstance(record.instanceId);
      }
      record.abortController.abort();
      record.resolveInvalidated();
    },
    collectReset(record) {
      for (const settlement of resetSettlements.splice(0)) {
        record(settlement.sequence, settlement.settle);
      }
    },
  };
  return ledger;
}

export async function completeModuleFailedOpen(options: {
  readonly record: SimulatorInstanceRecord;
  readonly engine: SimulatorStateEngine;
  readonly transition: () => Promise<SimulatorResult<JsonValue>>;
  readonly onInstanceFailed?: (instanceId: string, diagnostic: SimulatorError) => void;
}): Promise<SimulatorResult<{ readonly instanceId: string }>> {
  const { record, engine } = options;
  record.phase = 'failed';
  record.failureDiagnostic = simulatorError('SIMULATOR_MODULE_FAILED', {
    moduleId: record.moduleId,
    instanceId: record.instanceId,
  });
  const failed = await options.transition();
  if (!record.tokenValid || record.epoch !== engine.epoch) {
    return simulatorFail(simulatorError(
      record.epoch !== engine.epoch ? 'SIMULATOR_STALE_EPOCH' : 'SIMULATOR_INSTANCE_DISPOSED',
      { moduleId: record.moduleId, instanceId: record.instanceId },
    ));
  }
  if (!failed.ok) return simulatorFail(failed.error);
  options.onInstanceFailed?.(record.instanceId, record.failureDiagnostic);
  return simulatorFail(record.failureDiagnostic);
}

export async function completeInstanceFailedOpen(options: {
  readonly record: SimulatorInstanceRecord;
  readonly engine: SimulatorStateEngine;
  readonly cause: string;
  readonly failInstance: (instanceId: string, cause: string) => void;
}): Promise<SimulatorResult<{ readonly instanceId: string }>> {
  const { record, engine } = options;
  options.failInstance(record.instanceId, options.cause);
  await record.intents;
  if (engine.phase === 'terminal') {
    return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: record.moduleId,
      instanceId: record.instanceId,
    }));
  }
  if (record.epoch !== engine.epoch) {
    return simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', {
      moduleId: record.moduleId,
      instanceId: record.instanceId,
    }));
  }
  return simulatorFail(record.failureDiagnostic ?? simulatorError('SIMULATOR_INSTANCE_FAILED', {
    moduleId: record.moduleId,
    instanceId: record.instanceId,
  }));
}
