/**
 * Typed Simulator streams: IDs, activation, ordered item delivery from
 * committed events, and one-shot terminal completion.
 *
 * Authority: tables/simulator-state-engine-policy.yaml `stream` and
 * P-SIM-012 (streams). Stream items are delivered from committed State
 * Engine events in event-sequence order; terminals settle by stream
 * allocation sequence; stale-epoch delivery is forbidden.
 */

import type { JsonValue } from './json-value.ts';
import { validateSchema, type SimulatorSchema } from './schema.ts';

export type SimulatorStreamStatus = 'paused' | 'active' | 'terminal';

export type SimulatorStreamTerminal =
  | { readonly status: 'completed'; readonly value: JsonValue }
  | { readonly status: 'cancelled'; readonly reason: 'caller' | 'detach' | 'reset' | 'dispose' }
  | { readonly status: 'failed' };

export interface SimulatorStreamRecord {
  readonly streamId: string;
  readonly allocationSequence: number;
  readonly epoch: number;
  readonly ownerModuleId: string;
  readonly ownerInstanceId: string | null;
  readonly sourceEventType: string;
  readonly terminalEventType: string | null;
  readonly status: SimulatorStreamStatus;
  readonly observerAttached: boolean;
  readonly terminal: SimulatorStreamTerminal | null;
}

interface MutableStream {
  readonly streamId: string;
  readonly allocationSequence: number;
  readonly epoch: number;
  readonly ownerModuleId: string;
  readonly ownerInstanceId: string | null;
  readonly sourceEventType: string;
  readonly terminalEventType: string | null;
  readonly itemSchema: SimulatorSchema;
  readonly terminalSchema: SimulatorSchema;
  status: SimulatorStreamStatus;
  observerAttached: boolean;
  terminal: SimulatorStreamTerminal | null;
}

export type SimulatorStreamOpenError = 'SIMULATOR_RESOURCE_EXHAUSTED';

export interface SimulatorStreamRegistryOptions {
  readonly onItem: (streamId: string, item: JsonValue) => void;
  readonly onTerminal: (streamId: string, terminal: SimulatorStreamTerminal) => void;
  readonly maxStreams?: number;
}

export interface SimulatorStreamRegistry {
  open(input: {
    readonly streamId: string;
    readonly epoch: number;
    readonly ownerModuleId: string;
    readonly ownerInstanceId: string | null;
    readonly sourceEventType: string;
    readonly terminalEventType: string | null;
    readonly itemSchema: SimulatorSchema;
    readonly terminalSchema: SimulatorSchema;
  }): SimulatorStreamRecord | { readonly error: SimulatorStreamOpenError };
  attach(streamId: string): { readonly attached: boolean };
  activate(streamId: string): boolean;
  detach(streamId: string): SimulatorStreamTerminal | null;
  cancel(streamId: string, reason: 'caller' | 'detach' | 'reset' | 'dispose'): SimulatorStreamTerminal | null;
  fail(streamId: string): SimulatorStreamTerminal | null;
  /** Deliver one committed event to matching active streams in allocation order. */
  deliverEvent(fullEventType: string, payload: JsonValue): void;
  /** Terminal cancellation of every live stream in allocation order (reset). */
  cancelAllForReset(): readonly { readonly streamId: string; readonly allocationSequence: number; readonly terminal: SimulatorStreamTerminal }[];
  cancelAllForInstance(instanceId: string): readonly { readonly streamId: string; readonly terminal: SimulatorStreamTerminal }[];
  get(streamId: string): SimulatorStreamRecord | null;
  records(): readonly SimulatorStreamRecord[];
}

function snapshotOf(record: MutableStream): SimulatorStreamRecord {
  return Object.freeze({
    streamId: record.streamId,
    allocationSequence: record.allocationSequence,
    epoch: record.epoch,
    ownerModuleId: record.ownerModuleId,
    ownerInstanceId: record.ownerInstanceId,
    sourceEventType: record.sourceEventType,
    terminalEventType: record.terminalEventType,
    status: record.status,
    observerAttached: record.observerAttached,
    terminal: record.terminal,
  });
}

export function createStreamRegistry(options: SimulatorStreamRegistryOptions): SimulatorStreamRegistry {
  const streams: MutableStream[] = [];
  const byId = new Map<string, MutableStream>();
  const maxStreams = options.maxStreams ?? 10000;

  function terminate(record: MutableStream, terminal: SimulatorStreamTerminal): SimulatorStreamTerminal {
    record.status = 'terminal';
    record.terminal = terminal;
    options.onTerminal(record.streamId, terminal);
    return terminal;
  }

  return {
    open(input) {
      const liveCount = streams.filter((stream) => stream.status !== 'terminal').length;
      if (liveCount >= maxStreams) return { error: 'SIMULATOR_RESOURCE_EXHAUSTED' };
      const record: MutableStream = {
        streamId: input.streamId,
        allocationSequence: streams.length + 1,
        epoch: input.epoch,
        ownerModuleId: input.ownerModuleId,
        ownerInstanceId: input.ownerInstanceId,
        sourceEventType: input.sourceEventType,
        terminalEventType: input.terminalEventType,
        itemSchema: input.itemSchema,
        terminalSchema: input.terminalSchema,
        status: 'paused',
        observerAttached: false,
        terminal: null,
      };
      streams.push(record);
      byId.set(record.streamId, record);
      return snapshotOf(record);
    },
    attach(streamId) {
      const record = byId.get(streamId);
      if (!record || record.status === 'terminal' || record.observerAttached) {
        return { attached: false };
      }
      record.observerAttached = true;
      return { attached: true };
    },
    activate(streamId) {
      const record = byId.get(streamId);
      if (!record || record.status !== 'paused' || !record.observerAttached) return false;
      record.status = 'active';
      return true;
    },
    detach(streamId) {
      const record = byId.get(streamId);
      if (!record || record.status === 'terminal') return null;
      return terminate(record, { status: 'cancelled', reason: 'detach' });
    },
    cancel(streamId, reason) {
      const record = byId.get(streamId);
      if (!record || record.status === 'terminal') return null;
      return terminate(record, { status: 'cancelled', reason });
    },
    fail(streamId) {
      const record = byId.get(streamId);
      if (!record || record.status === 'terminal') return null;
      return terminate(record, { status: 'failed' });
    },
    deliverEvent(fullEventType, payload) {
      // Snapshot the matching streams first so terminal transitions during one
      // delivery cannot reorder later deliveries of the same event.
      const matching = streams
        .filter((stream) => (
          stream.status === 'active'
          && (stream.sourceEventType === fullEventType || stream.terminalEventType === fullEventType)
        ))
        .sort((left, right) => left.allocationSequence - right.allocationSequence);
      for (const stream of matching) {
        if (stream.status !== 'active') continue;
        if (stream.terminalEventType === fullEventType) {
          const validation = validateSchema(stream.terminalSchema, payload);
          if (validation.ok) {
            terminate(stream, { status: 'completed', value: validation.value });
          } else {
            terminate(stream, { status: 'failed' });
          }
          continue;
        }
        const validation = validateSchema(stream.itemSchema, payload);
        if (!validation.ok) {
          terminate(stream, { status: 'failed' });
          continue;
        }
        options.onItem(stream.streamId, validation.value);
      }
    },
    cancelAllForReset() {
      const terminals: { streamId: string; allocationSequence: number; terminal: SimulatorStreamTerminal }[] = [];
      const live = streams
        .filter((stream) => stream.status !== 'terminal')
        .sort((left, right) => left.allocationSequence - right.allocationSequence);
      for (const stream of live) {
        terminals.push({
          streamId: stream.streamId,
          allocationSequence: stream.allocationSequence,
          terminal: terminate(stream, { status: 'cancelled', reason: 'reset' }),
        });
      }
      return terminals;
    },
    cancelAllForInstance(instanceId) {
      const terminals: { streamId: string; terminal: SimulatorStreamTerminal }[] = [];
      const live = streams
        .filter((stream) => stream.status !== 'terminal' && stream.ownerInstanceId === instanceId)
        .sort((left, right) => left.allocationSequence - right.allocationSequence);
      for (const stream of live) {
        terminals.push({ streamId: stream.streamId, terminal: terminate(stream, { status: 'cancelled', reason: 'dispose' }) });
      }
      return terminals;
    },
    get(streamId) {
      const record = byId.get(streamId);
      return record ? snapshotOf(record) : null;
    },
    records() {
      return streams.map(snapshotOf);
    },
  };
}
