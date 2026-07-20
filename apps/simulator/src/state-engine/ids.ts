/**
 * Canonical Simulator identifier allocation and validation.
 *
 * Authority: tables/simulator-state-engine-policy.yaml `canonical_ids`.
 * IDs are `<epoch>:<kind>:<allocation-sequence>`; sequences restart at 1 per
 * epoch and earlier-epoch IDs are never reused.
 */

export type SimulatorAllocationKind =
  | 'op'
  | 'evt'
  | 'job'
  | 'instance'
  | 'overlay'
  | 'stream'
  | 'ready'
  | 'async';

const CANONICAL_ID_PATTERN = /^([0-9]+):(op|evt|job|instance|overlay|stream|ready|async):([0-9]+)$/;

export class SimulatorIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatorIdError';
  }
}

export function assertSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SimulatorIdError(`${label} must be a safe non-negative integer`);
  }
  return value;
}

export function formatCanonicalId(epoch: number, kind: SimulatorAllocationKind, sequence: number): string {
  assertSafeNonNegativeInteger(epoch, 'epoch');
  assertSafeNonNegativeInteger(sequence, 'allocation sequence');
  if (epoch < 1) throw new SimulatorIdError('the first session epoch is 1');
  if (sequence < 1) throw new SimulatorIdError('allocation sequences begin at 1');
  return `${epoch}:${kind}:${sequence}`;
}

export function parseCanonicalId(id: string): { epoch: number; kind: SimulatorAllocationKind; sequence: number } {
  const match = typeof id === 'string' ? CANONICAL_ID_PATTERN.exec(id) : null;
  if (!match) throw new SimulatorIdError('identifier is not in canonical <epoch>:<kind>:<sequence> form');
  const epoch = Number(match[1]);
  const sequence = Number(match[3]);
  assertSafeNonNegativeInteger(epoch, 'epoch');
  assertSafeNonNegativeInteger(sequence, 'allocation sequence');
  if (epoch < 1 || sequence < 1) throw new SimulatorIdError('epoch and allocation sequence are positive');
  return { epoch, kind: match[2] as SimulatorAllocationKind, sequence };
}

/**
 * Per-epoch allocation counter. `next()` fails closed before the counter
 * would exceed Number.MAX_SAFE_INTEGER so IDs stay exactly representable.
 */
export interface SimulatorSequenceAllocator {
  next(): number;
  readonly current: number;
}

export function createSequenceAllocator(): SimulatorSequenceAllocator {
  let current = 0;
  return {
    next() {
      if (current >= Number.MAX_SAFE_INTEGER) {
        throw new SimulatorIdError('allocation sequence overflow');
      }
      current += 1;
      return current;
    },
    get current() {
      return current;
    },
  };
}

/** Allocators for every canonical ID family of one epoch. */
export interface SimulatorEpochAllocators {
  readonly op: SimulatorSequenceAllocator;
  readonly evt: SimulatorSequenceAllocator;
  readonly job: SimulatorSequenceAllocator;
  readonly instance: SimulatorSequenceAllocator;
  readonly overlay: SimulatorSequenceAllocator;
  readonly stream: SimulatorSequenceAllocator;
  readonly ready: SimulatorSequenceAllocator;
  readonly asyncReservation: SimulatorSequenceAllocator;
}

export function createEpochAllocators(): SimulatorEpochAllocators {
  return {
    op: createSequenceAllocator(),
    evt: createSequenceAllocator(),
    job: createSequenceAllocator(),
    instance: createSequenceAllocator(),
    overlay: createSequenceAllocator(),
    stream: createSequenceAllocator(),
    ready: createSequenceAllocator(),
    asyncReservation: createSequenceAllocator(),
  };
}
