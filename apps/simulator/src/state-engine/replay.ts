/** Strict deterministic replay and byte-exact component evidence. */

import { canonicalizeJson, type JsonValue } from './json-value.ts';
import { sha256HexOfText } from './sha256.ts';
import type { SimulatorResult } from './errors.ts';
import {
  createSimulatorStateEngine,
  type SimulatorReplayRecord,
  type SimulatorStateEngine,
  type SimulatorStateEngineHooks,
  type SimulatorStreamMethodDeclaration,
} from './engine.ts';
import { replayStreamMethodIdentity } from './replay-identity.ts';
import type {
  SimulatorModuleDefinition,
  SimulatorScenarioDeclaration,
} from './types.ts';

const REPLAY_FAILURE = 'SIMULATOR_REPLAY_MISMATCH';

export function simulatorReplayRecordDigest(record: SimulatorReplayRecord): string {
  return `sha256:${sha256HexOfText(canonicalizeJson(record as unknown as JsonValue))}`;
}

export interface SimulatorReplayOptions {
  readonly scenario: SimulatorScenarioDeclaration;
  readonly modules: readonly SimulatorModuleDefinition[];
  readonly streamMethods?: readonly SimulatorStreamMethodDeclaration[];
  readonly hooks?: SimulatorStateEngineHooks;
  /** Called for every replayed external operation settlement, in order. */
  readonly onOperation?: (result: SimulatorResult<JsonValue>) => void;
}

export interface SimulatorReplayOutcome {
  readonly engine: SimulatorStateEngine;
  readonly matches: boolean;
  readonly recomputed: SimulatorReplayRecord['expected'];
  readonly expected: SimulatorReplayRecord['expected'];
}

function replayFailure(): never {
  throw new Error(REPLAY_FAILURE);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
  } catch {
    return false;
  }
}

function assertReplayIdentity(record: SimulatorReplayRecord, options: SimulatorReplayOptions): void {
  const scenario = options.scenario;
  if (
    record.protocolRevision !== 1
    || record.scenarioId !== scenario.scenarioId
    || record.scenarioRevision !== scenario.scenarioRevision
    || record.seed !== scenario.seed
    || record.initialLogicalTime !== scenario.initialLogicalTime
  ) replayFailure();
  const moduleIds = options.modules.map((module) => module.moduleId);
  if (new Set(moduleIds).size !== moduleIds.length || !sameJson(record.moduleIds, moduleIds)) replayFailure();
  const streamMethods = (options.streamMethods ?? []).map(replayStreamMethodIdentity);
  if (!sameJson(record.streamMethods, streamMethods)) replayFailure();
  if (!Array.isArray(record.inputs) || !Array.isArray(record.operationSettlements)) replayFailure();
}

/** Re-executes one complete component replay ledger in a fresh engine. */
export async function replaySimulatorSession(
  record: SimulatorReplayRecord,
  options: SimulatorReplayOptions,
): Promise<SimulatorReplayOutcome> {
  assertReplayIdentity(record, options);
  const engine = createSimulatorStateEngine({ scenario: options.scenario, hooks: options.hooks });
  for (const definition of options.modules) {
    const { behavior, ...catalog } = definition;
    engine.registerModuleCatalog(catalog);
    const attached = engine.attachModuleBehavior(definition.moduleId, behavior);
    if (!attached.ok) replayFailure();
  }
  for (const method of options.streamMethods ?? []) engine.registerStreamMethod(method);

  const reservations = new Map<string, 'open' | 'terminal' | 'reset'>();
  const reservationSequences = new Map<number, number>();
  const streams = new Map<string, 'open' | 'terminal'>();
  const streamSequences = new Map<number, number>();

  for (const entry of record.inputs) {
    switch (entry.kind) {
      case 'operation': {
        if (!entry.operation || typeof entry.operation.type !== 'string') replayFailure();
        const operation = entry.operation;
        const result = operation.kind === 'command'
          ? await engine.acceptCommand(operation.type, operation.payload, operation.issuer, operation.causationId)
          : operation.kind === 'query'
            ? await engine.acceptQuery(operation.type, operation.payload, operation.issuer)
            : replayFailure();
        options.onOperation?.(result);
        if (operation.kind === 'command' && operation.type === 'simulator.reset' && result.ok) {
          for (const [reservationId, state] of reservations) {
            if (state === 'open') reservations.set(reservationId, 'reset');
          }
        }
        break;
      }
      case 'reservation-allocate': {
        const allocation = entry.allocation;
        const expectedSequence = (reservationSequences.get(allocation.epoch) ?? 0) + 1;
        if (
          allocation.epoch !== engine.epoch
          || allocation.allocationSequence !== expectedSequence
          || allocation.reservationId !== `${allocation.epoch}:async:${allocation.allocationSequence}`
          || reservations.has(allocation.reservationId)
        ) replayFailure();
        const allocated = engine.reserveAsync({
          issuer: allocation.issuer,
          causationId: allocation.causationId,
          commandType: allocation.commandType,
          outcomeSchemaId: allocation.outcomeSchemaId,
        });
        if (!allocated.ok || allocated.value.reservationId !== allocation.reservationId) replayFailure();
        reservationSequences.set(allocation.epoch, allocation.allocationSequence);
        reservations.set(allocation.reservationId, 'open');
        break;
      }
      case 'reservation-terminal': {
        const terminal = entry.reservation;
        if (
          terminal.reservationId !== `${terminal.epoch}:async:${terminal.allocationSequence}`
          || !reservations.has(terminal.reservationId)
        ) replayFailure();
        const state = reservations.get(terminal.reservationId);
        if (terminal.resolution === 'cancelled' && terminal.cancelReason === 'reset' && state === 'reset') {
          reservations.set(terminal.reservationId, 'terminal');
          break;
        }
        if (state !== 'open') replayFailure();
        engine.applyReplayReservationTerminal(
          terminal.reservationId,
          terminal.resolution,
          terminal.outcome,
          terminal.cancelReason,
        );
        reservations.set(terminal.reservationId, 'terminal');
        break;
      }
      case 'stream-allocate': {
        const allocation = entry.stream;
        const expectedSequence = (streamSequences.get(allocation.epoch) ?? 0) + 1;
        if (
          allocation.allocationSequence !== expectedSequence
          || allocation.streamId !== `${allocation.epoch}:stream:${allocation.allocationSequence}`
          || streams.has(allocation.streamId)
        ) replayFailure();
        streamSequences.set(allocation.epoch, allocation.allocationSequence);
        streams.set(allocation.streamId, 'open');
        break;
      }
      case 'stream-terminal': {
        const terminal = entry.stream;
        if (
          terminal.streamId !== `${terminal.epoch}:stream:${terminal.allocationSequence}`
          || streams.get(terminal.streamId) !== 'open'
        ) replayFailure();
        streams.set(terminal.streamId, 'terminal');
        break;
      }
      case 'stream-attach': {
        const attachment = entry.stream;
        if (
          attachment.streamId !== `${attachment.epoch}:stream:${attachment.allocationSequence}`
          || streams.get(attachment.streamId) !== 'open'
        ) replayFailure();
        const handle = engine.streamHandle(attachment.streamId);
        const attached = handle?.attach(() => undefined);
        if (!attached?.ok || !attached.value.attached) replayFailure();
        break;
      }
      default:
        replayFailure();
    }
  }
  if (
    [...reservations.values()].some((state) => state !== 'terminal')
    || [...streams.values()].some((state) => state !== 'terminal')
  ) replayFailure();

  const recomputedRecord = engine.buildReplayRecord();
  const recomputed = recomputedRecord.expected;
  const matches = (
    sameJson(recomputedRecord.inputs, record.inputs)
    && sameJson(recomputedRecord.operationSettlements, record.operationSettlements)
    && recomputed.epoch === record.expected.epoch
    && recomputed.revision === record.expected.revision
    && recomputed.logicalTime === record.expected.logicalTime
    && recomputed.stateDigest === record.expected.stateDigest
    && recomputed.eventDigest === record.expected.eventDigest
    && sameJson(recomputed.random, record.expected.random)
  );
  return { engine, matches, recomputed, expected: record.expected };
}
