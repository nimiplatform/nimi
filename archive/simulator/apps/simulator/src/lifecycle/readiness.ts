/**
 * Minimal surface lifecycle readiness.
 *
 * An App reports that its mounted surface is ready. The Simulator records the
 * transition through the State Engine so reset and disposal keep one ordering
 * model. Product semantics remain a user-visible concern; this lifecycle does
 * not inspect DOM markers, frames, projections, or acceptance checkpoints.
 */

import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorResult,
} from '../state-engine/errors.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';

export type SimulatorReadinessState =
  | 'idle'
  | 'signaled'
  | 'usable'
  | 'cancelled'
  | 'failed';

export type SimulatorReadinessTerminalReason =
  | 'ready'
  | 'dispose'
  | 'reset'
  | 'stale-epoch'
  | 'state-change'
  | 'instance-failure'
  | 'module-failure'
  | 'session-failure';

export interface SimulatorReadinessTerminal {
  readonly state: 'usable' | 'cancelled' | 'failed';
  readonly reason: SimulatorReadinessTerminalReason;
  readonly markedAtLogicalTime: number | null;
}

export interface SimulatorReadinessBarrierOptions {
  readonly engine: SimulatorStateEngine;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly onStateChange?: (state: SimulatorReadinessState) => void;
}

export interface SimulatorReadinessBarrier {
  readonly readinessId: string | null;
  readonly state: SimulatorReadinessState;
  signalCandidate(): SimulatorResult<{ readonly signaled: boolean }>;
  cancel(reason: SimulatorReadinessTerminalReason): void;
  /** Invalidates immediately but defers observable completion to reset ordering. */
  beginResetCancellation(): { readonly settle: () => void } | null;
  readonly completion: Promise<SimulatorReadinessTerminal>;
}

export function createReadinessBarrier(options: SimulatorReadinessBarrierOptions): SimulatorReadinessBarrier {
  const { engine } = options;
  let state: SimulatorReadinessState = 'idle';
  let readinessId: string | null = null;
  let reservation: {
    settle(outcome: JsonValue): SimulatorResult<{ readonly accepted: boolean }>;
    cancel(reason: 'caller' | 'dispose' | 'reset'): SimulatorResult<{ readonly cancelled: boolean }>;
  } | null = null;
  let resolveCompletion: (terminal: SimulatorReadinessTerminal) => void = () => undefined;
  let completionSettled = false;
  const completion = new Promise<SimulatorReadinessTerminal>((resolve) => {
    resolveCompletion = resolve;
  });

  function setState(next: SimulatorReadinessState): void {
    state = next;
    options.onStateChange?.(next);
  }

  function settleCompletion(
    terminalState: 'usable' | 'cancelled' | 'failed',
    reason: SimulatorReadinessTerminalReason,
    markedAtLogicalTime: number | null,
  ): void {
    if (completionSettled) return;
    completionSettled = true;
    resolveCompletion(Object.freeze({ state: terminalState, reason, markedAtLogicalTime }));
  }

  function isCurrentReadyInstance(): boolean {
    if (engine.epoch !== options.epoch) return false;
    const instance = engine.getCommitted().instance(options.instanceId);
    return Boolean(
      instance
      && instance.surfaceId === options.surfaceId
      && (instance.status === 'inactive' || instance.status === 'active'),
    );
  }

  function fail(): void {
    reservation = null;
    setState('failed');
    settleCompletion('failed', 'state-change', null);
  }

  function cancelWith(reason: SimulatorReadinessTerminalReason): void {
    if (state === 'usable' || state === 'cancelled' || state === 'failed') return;
    const activeReservation = reservation;
    reservation = null;
    activeReservation?.cancel(reason === 'reset' ? 'reset' : 'dispose');
    setState('cancelled');
    settleCompletion('cancelled', reason, null);
  }

  function beginResetCancellation(): { readonly settle: () => void } | null {
    if (state === 'usable' || state === 'cancelled' || state === 'failed') return null;
    const activeReservation = reservation;
    reservation = null;
    activeReservation?.cancel('reset');
    setState('cancelled');
    let settled = false;
    return Object.freeze({
      settle() {
        if (settled) return;
        settled = true;
        settleCompletion('cancelled', 'reset', null);
      },
    });
  }

  const barrier: SimulatorReadinessBarrier = {
    get readinessId() {
      return readinessId;
    },
    get state() {
      return state;
    },
    signalCandidate() {
      if (state !== 'idle') {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
      }
      if (engine.epoch !== options.epoch) {
        return simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', { instanceId: options.instanceId }));
      }
      if (!isCurrentReadyInstance()) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
      }
      const allocation = engine.allocateReadinessId();
      if (!allocation.ok) return simulatorFail(allocation.error);
      readinessId = allocation.value.readinessId;
      const markedAtLogicalTime = engine.getCommitted().logicalTime;
      const reserved = engine.reserveAsync({
        issuer: { kind: 'shell', moduleId: null, instanceId: null },
        causationId: null,
        commandType: 'simulator.readiness.settle',
        outcomeSchemaId: 'simulator-readiness-terminal',
        onCommandSettlement(result) {
          reservation = null;
          if (!result.ok) {
            fail();
            return;
          }
          setState('usable');
          settleCompletion('usable', 'ready', markedAtLogicalTime);
        },
      });
      if (!reserved.ok) return simulatorFail(reserved.error);
      reservation = reserved.value;
      setState('signaled');
      const settled = reservation.settle({
        readinessId,
        surfaceId: options.surfaceId,
        instanceId: options.instanceId,
        state: 'usable',
        reason: 'ready',
        markedAtLogicalTime,
      });
      if (!settled.ok || !settled.value.accepted) {
        fail();
        return simulatorFail(settled.ok
          ? simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId })
          : settled.error);
      }
      return simulatorOk({ signaled: true });
    },
    cancel: cancelWith,
    beginResetCancellation,
    completion,
  };
  return Object.freeze(barrier);
}
