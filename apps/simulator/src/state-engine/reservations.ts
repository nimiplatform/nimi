/**
 * Ordered asynchronous reservation pump.
 *
 * Authority: tables/simulator-state-engine-policy.yaml `async_reservation`
 * and simulator-protocol.md §11.6. External state-affecting Promise work
 * reserves release order synchronously before awaiting; settlement timing
 * writes only a typed completion buffer; release is strictly by allocation
 * sequence. Promise timing is never ordering truth.
 */

import type { JsonValue } from './json-value.ts';
import { validateSchema, type SimulatorSchema } from './schema.ts';
import { simulatorError, simulatorOk, simulatorFail, type SimulatorResult } from './errors.ts';

export type SimulatorAsyncReservationCancelReason = 'caller' | 'dispose' | 'reset';
export type SimulatorAsyncReservationState = 'open' | 'buffered' | 'released' | 'cancelled';

export interface SimulatorAsyncReservationIssuer {
  readonly kind: 'shell' | 'instance' | 'scenario';
  readonly moduleId: string | null;
  readonly instanceId: string | null;
}

export interface SimulatorAsyncReservationTerminal {
  readonly status: 'released' | 'cancelled';
  readonly outcome: JsonValue | null;
  readonly cancelReason: SimulatorAsyncReservationCancelReason | null;
}

export interface SimulatorAsyncReservationRecord {
  readonly reservationId: string;
  readonly allocationSequence: number;
  readonly epoch: number;
  readonly issuer: SimulatorAsyncReservationIssuer;
  readonly causationId: string | null;
  readonly commandType: string;
  readonly outcomeSchemaId: string;
  readonly state: SimulatorAsyncReservationState;
  readonly terminal: SimulatorAsyncReservationTerminal | null;
}

export interface SimulatorAsyncReservationHandle {
  readonly reservationId: string;
  settle(outcome: JsonValue): SimulatorResult<{ readonly accepted: boolean }>;
  cancel(reason: SimulatorAsyncReservationCancelReason): SimulatorResult<{ readonly cancelled: boolean }>;
}

interface MutableReservation {
  reservationId: string;
  allocationSequence: number;
  epoch: number;
  issuer: SimulatorAsyncReservationIssuer;
  causationId: string | null;
  commandType: string;
  outcomeSchemaId: string;
  outcomeSchema: SimulatorSchema;
  state: SimulatorAsyncReservationState;
  outcome: JsonValue | null;
  cancelReason: SimulatorAsyncReservationCancelReason | null;
  terminal: SimulatorAsyncReservationTerminal | null;
}

export interface SimulatorAsyncReservationPumpOptions {
  readonly onRelease: (record: SimulatorAsyncReservationRecord, outcome: JsonValue) => void;
}

export interface SimulatorAsyncReservationPump {
  reserve(input: {
    readonly reservationId: string;
    readonly epoch: number;
    readonly issuer: SimulatorAsyncReservationIssuer;
    readonly causationId: string | null;
    readonly commandType: string;
    readonly outcomeSchemaId: string;
    readonly outcomeSchema: SimulatorSchema;
  }): SimulatorAsyncReservationHandle;
  /** Cancel every non-released reservation in allocation order (dispose/reset). */
  cancelAll(reason: SimulatorAsyncReservationCancelReason): readonly SimulatorAsyncReservationRecord[];
  /** Cancel one instance's reservations, then release any newly unblocked slots. */
  cancelAllForInstance(
    instanceId: string,
    reason: SimulatorAsyncReservationCancelReason,
  ): readonly SimulatorAsyncReservationRecord[];
  /** Allocation-ordered allocation/terminal ledger for replay and reset evidence. */
  ledger(): readonly SimulatorAsyncReservationRecord[];
  hasImmediatelyReleasable(): boolean;
}

function snapshotOf(record: MutableReservation): SimulatorAsyncReservationRecord {
  return Object.freeze({
    reservationId: record.reservationId,
    allocationSequence: record.allocationSequence,
    epoch: record.epoch,
    issuer: record.issuer,
    causationId: record.causationId,
    commandType: record.commandType,
    outcomeSchemaId: record.outcomeSchemaId,
    state: record.state,
    terminal: record.terminal,
  });
}

export function createAsyncReservationPump(options: SimulatorAsyncReservationPumpOptions): SimulatorAsyncReservationPump {
  const reservations: MutableReservation[] = [];

  function pump(): void {
    // Release strictly by allocation sequence: the earliest non-terminal slot
    // gates every later slot. A later buffered reservation never overtakes.
    for (const record of reservations) {
      if (record.state === 'released' || record.state === 'cancelled') continue;
      if (record.state === 'open') return;
      // buffered at head: release now.
      record.state = 'released';
      record.terminal = Object.freeze({ status: 'released', outcome: record.outcome, cancelReason: null });
      const outcome = record.outcome;
      record.outcome = null;
      options.onRelease(snapshotOf(record), outcome as JsonValue);
    }
  }

  function reserve(input: {
    readonly reservationId: string;
    readonly epoch: number;
    readonly issuer: SimulatorAsyncReservationIssuer;
    readonly causationId: string | null;
    readonly commandType: string;
    readonly outcomeSchemaId: string;
    readonly outcomeSchema: SimulatorSchema;
  }): SimulatorAsyncReservationHandle {
    const record: MutableReservation = {
      reservationId: input.reservationId,
      allocationSequence: reservations.length + 1,
      epoch: input.epoch,
      issuer: input.issuer,
      causationId: input.causationId,
      commandType: input.commandType,
      outcomeSchemaId: input.outcomeSchemaId,
      outcomeSchema: input.outcomeSchema,
      state: 'open',
      outcome: null,
      cancelReason: null,
      terminal: null,
    };
    reservations.push(record);

    return Object.freeze({
      reservationId: record.reservationId,
      settle(outcome: JsonValue): SimulatorResult<{ readonly accepted: boolean }> {
        // Terminal one-shot behavior is epoch-independent: a late settle after
        // cancel/release returns accepted:false, never SIMULATOR_STALE_EPOCH.
        if (record.state !== 'open') {
          return simulatorOk({ accepted: false });
        }
        const validation = validateSchema(record.outcomeSchema, outcome);
        if (!validation.ok) {
          return simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
            moduleId: record.issuer.moduleId,
            instanceId: record.issuer.instanceId,
          }));
        }
        record.state = 'buffered';
        record.outcome = validation.value;
        pump();
        return simulatorOk({ accepted: true });
      },
      cancel(reason: SimulatorAsyncReservationCancelReason): SimulatorResult<{ readonly cancelled: boolean }> {
        if (record.state === 'released' || record.state === 'cancelled') {
          return simulatorOk({ cancelled: false });
        }
        record.state = 'cancelled';
        record.outcome = null;
        record.cancelReason = reason;
        record.terminal = Object.freeze({ status: 'cancelled', outcome: null, cancelReason: reason });
        pump();
        return simulatorOk({ cancelled: true });
      },
    });
  }

  return {
    reserve,
    cancelAll(reason) {
      const cancelled: SimulatorAsyncReservationRecord[] = [];
      for (const record of reservations) {
        if (record.state === 'released' || record.state === 'cancelled') continue;
        record.state = 'cancelled';
        record.outcome = null;
        record.cancelReason = reason;
        record.terminal = Object.freeze({ status: 'cancelled', outcome: null, cancelReason: reason });
        cancelled.push(snapshotOf(record));
      }
      // No pump: cancellation of every remaining slot leaves nothing releasable.
      return cancelled;
    },
    cancelAllForInstance(instanceId, reason) {
      const cancelled: SimulatorAsyncReservationRecord[] = [];
      for (const record of reservations) {
        if (record.issuer.instanceId !== instanceId) continue;
        if (record.state === 'released' || record.state === 'cancelled') continue;
        record.state = 'cancelled';
        record.outcome = null;
        record.cancelReason = reason;
        record.terminal = Object.freeze({ status: 'cancelled', outcome: null, cancelReason: reason });
        cancelled.push(snapshotOf(record));
      }
      pump();
      return cancelled;
    },
    ledger() {
      return reservations.map(snapshotOf);
    },
    hasImmediatelyReleasable() {
      for (const record of reservations) {
        if (record.state === 'released' || record.state === 'cancelled') continue;
        return record.state === 'buffered';
      }
      return false;
    },
  };
}
