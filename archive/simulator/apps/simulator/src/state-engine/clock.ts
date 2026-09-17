/**
 * Deterministic logical clock and scheduled job table.
 *
 * Authority: tables/simulator-state-engine-policy.yaml `logical_clock`.
 * Logical time advances only through explicit integer advanceBy/advanceTo;
 * jobs order by due time then allocation sequence and enqueue typed commands
 * rather than mutating state directly.
 */

import type { JsonValue } from './json-value.ts';

export interface SimulatorScheduledCommandInput {
  readonly type: string;
  readonly payload: JsonValue;
  readonly causationId: string | null;
  readonly issuerModuleId: string | null;
  readonly issuerInstanceId: string | null;
}

export interface SimulatorClockJob {
  readonly jobId: string;
  readonly dueTime: number;
  readonly allocationSequence: number;
  readonly command: SimulatorScheduledCommandInput;
  status: 'pending' | 'queued' | 'cancelled';
}

export type SimulatorClockError =
  | 'SIMULATOR_CLOCK_DELAY'
  | 'SIMULATOR_CLOCK_OVERFLOW'
  | 'SIMULATOR_CLOCK_BACKWARD';

export class SimulatorLogicalClockError extends Error {
  readonly code: SimulatorClockError;
  constructor(code: SimulatorClockError, message: string) {
    super(message);
    this.name = 'SimulatorLogicalClockError';
    this.code = code;
  }
}

export function assertValidDelay(now: number, delayMs: number): number {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new SimulatorLogicalClockError(
      'SIMULATOR_CLOCK_DELAY',
      'schedule delay must be a finite non-negative safe integer',
    );
  }
  const due = now + delayMs;
  if (!Number.isSafeInteger(due) || due > Number.MAX_SAFE_INTEGER) {
    throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_OVERFLOW', 'schedule due time overflows logical time');
  }
  return due;
}

export interface SimulatorLogicalClock {
  readonly now: number;
  readonly pendingJobCount: number;
  schedule(jobId: string, allocationSequence: number, command: SimulatorScheduledCommandInput, delayMs: number): SimulatorClockJob;
  cancel(jobId: string): { readonly cancelled: boolean };
  markQueued(jobId: string): void;
  /** Due pending jobs in (dueTime, allocationSequence) order at or before `upTo`. */
  collectDue(upTo: number): readonly SimulatorClockJob[];
  /** Non-destructive due-job check for quiescence reporting. */
  collectDuePreview(upTo: number): readonly SimulatorClockJob[];
  advanceBy(deltaMs: number): number;
  advanceTo(targetMs: number): number;
  pendingJobs(): readonly SimulatorClockJob[];
  /** Cancels every pending job without enqueueing work. */
  cancelAll(): readonly SimulatorClockJob[];
}

export function createLogicalClock(initialNow: number): SimulatorLogicalClock {
  if (!Number.isSafeInteger(initialNow) || initialNow < 0) {
    throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_DELAY', 'initial logical time must be a safe non-negative integer');
  }
  let now = initialNow;
  const jobs = new Map<string, SimulatorClockJob>();

  function advanceToInternal(target: number): number {
    if (!Number.isSafeInteger(target) || target < 0) {
      throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_DELAY', 'logical time target must be a safe non-negative integer');
    }
    if (target < now) {
      throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_BACKWARD', 'advanceTo cannot move logical time backward');
    }
    now = target;
    return now;
  }

  return {
    get now() {
      return now;
    },
    get pendingJobCount() {
      let count = 0;
      for (const job of jobs.values()) if (job.status === 'pending') count += 1;
      return count;
    },
    schedule(jobId, allocationSequence, command, delayMs) {
      const dueTime = assertValidDelay(now, delayMs);
      const job: SimulatorClockJob = { jobId, dueTime, allocationSequence, command, status: 'pending' };
      jobs.set(jobId, job);
      return job;
    },
    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'pending') return { cancelled: false };
      job.status = 'cancelled';
      jobs.delete(jobId);
      return { cancelled: true };
    },
    markQueued(jobId) {
      const job = jobs.get(jobId);
      if (job && job.status === 'pending') {
        job.status = 'queued';
        jobs.delete(jobId);
      }
    },
    collectDue(upTo) {
      const due = [...jobs.values()]
        .filter((job) => job.status === 'pending' && job.dueTime <= upTo)
        .sort((left, right) => (left.dueTime - right.dueTime) || (left.allocationSequence - right.allocationSequence));
      for (const job of due) {
        job.status = 'queued';
        jobs.delete(job.jobId);
      }
      return due;
    },
    collectDuePreview(upTo) {
      return [...jobs.values()]
        .filter((job) => job.status === 'pending' && job.dueTime <= upTo)
        .sort((left, right) => (left.dueTime - right.dueTime) || (left.allocationSequence - right.allocationSequence));
    },
    advanceBy(deltaMs) {
      if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
        throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_DELAY', 'advanceBy delta must be a safe non-negative integer');
      }
      const target = now + deltaMs;
      if (!Number.isSafeInteger(target)) {
        throw new SimulatorLogicalClockError('SIMULATOR_CLOCK_OVERFLOW', 'advanceBy overflows logical time');
      }
      return advanceToInternal(target);
    },
    advanceTo: advanceToInternal,
    pendingJobs() {
      return [...jobs.values()]
        .filter((job) => job.status === 'pending')
        .sort((left, right) => (left.dueTime - right.dueTime) || (left.allocationSequence - right.allocationSequence));
    },
    cancelAll() {
      const pending = [...jobs.values()]
        .filter((job) => job.status === 'pending')
        .sort((left, right) => left.allocationSequence - right.allocationSequence);
      for (const job of pending) {
        job.status = 'cancelled';
        jobs.delete(job.jobId);
      }
      return pending;
    },
  };
}
