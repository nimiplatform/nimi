/**
 * Simulator State Engine session context: the single mutable session state
 * shared by the bounded engine modules. Construction and small settlement /
 * projection helpers live here; behavior lives in the engine modules.
 *
 * Authority: P-SIM-010..012; tables/simulator-state-engine-policy.yaml.
 */

import {
  assertJsonValue,
  canonicalizeJson,
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from './json-value.ts';
import { sha256HexOfText } from './sha256.ts';
import {
  decodeSimulatorSeed,
  simulatorRandomToSnapshot,
} from './random.ts';
import type { SimulatorError, SimulatorResult } from './errors.ts';
import {
  createEpochAllocators,
  type SimulatorEpochAllocators,
} from './ids.ts';
import {
  createOperationCatalog,
  type SimulatorOperationCatalog,
} from './catalog.ts';
import { createLogicalClock, type SimulatorLogicalClock } from './clock.ts';
import {
  createAsyncReservationPump,
  type SimulatorAsyncReservationPump,
} from './reservations.ts';
import {
  createStreamRegistry,
  type SimulatorStreamRegistry,
  type SimulatorStreamTerminal,
} from './streams.ts';
import type {
  SimulatorEventRecord,
  SimulatorIssuer,
  SimulatorModuleBehavior,
  SimulatorModuleCatalogDeclaration,
  SimulatorSnapshotPartitions,
} from './types.ts';
import {
  SIMULATOR_MAX_OPERATIONS_PER_DRAIN,
  freezeInstancePresentation,
  type CommittedState,
  type EventSubscriber,
  type QueuedOperation,
  type SettlementRecord,
  type SimulatorReplayLedgerEntry,
  type SimulatorReplayOperationSettlement,
  type SimulatorResetTerminalSettlement,
  type SimulatorStateEngineHooks,
  type SimulatorStateEngineOptions,
} from './engine-types.ts';

export interface StreamHandleRecord {
  observer: ((item: JsonValue) => unknown) | null;
  completion: Promise<SimulatorStreamTerminal>;
  resolveCompletion: (terminal: SimulatorStreamTerminal) => void;
}

export interface EngineContext {
  readonly hooks: SimulatorStateEngineHooks;
  readonly wiring: EngineContextWiring;
  readonly maxOperationsPerDrain: number;
  readonly scenario: SimulatorStateEngineOptions['scenario'];
  readonly catalog: SimulatorOperationCatalog;
  readonly moduleCatalogs: Map<string, SimulatorModuleCatalogDeclaration>;
  readonly moduleBehaviors: Map<string, SimulatorModuleBehavior>;
  readonly streamMethods: Map<string, import('./engine-types.ts').SimulatorStreamMethodDeclaration>;
  readonly loadedModules: Set<string>;
  phase: 'open' | 'resetting' | 'terminal';
  epoch: number;
  allocators: SimulatorEpochAllocators;
  queue: QueuedOperation[];
  draining: boolean;
  callbackRunning: boolean;
  operationsThisDrain: number;
  settlements: SettlementRecord[];
  terminalError: SimulatorError | null;
  capabilities: ReadonlySet<string>;
  stateSubscribers: { readonly sequence: number; readonly listener: (revision: number) => unknown }[];
  eventSubscribers: EventSubscriber[];
  prepareWindows: Map<string, { closed: boolean; subscriptionCount: number }>;
  stateSubscriberSequence: number;
  eventLog: SimulatorEventRecord[];
  replayInputs: SimulatorReplayLedgerEntry[];
  replayReservationHandles: Map<string, import('./reservations.ts').SimulatorAsyncReservationHandle>;
  replayExternalOperations: Map<number, {
    readonly operationId: string;
    readonly acceptanceOrder: number;
  }>;
  replayAcceptanceOrder: number;
  replayOperationSettlements: SimulatorReplayOperationSettlement[];
  reservationResultSinks: Map<string, (result: SimulatorResult<JsonValue>) => void>;
  committed: CommittedState;
  clock: SimulatorLogicalClock;
  streams: SimulatorStreamRegistry;
  readonly streamHandles: Map<string, StreamHandleRecord>;
  pump: SimulatorAsyncReservationPump;
  resetContext: {
    operation: QueuedOperation;
    oldEpoch: number;
    detachedTail: QueuedOperation[];
  } | null;
  resetTerminalCapture: SimulatorResetTerminalSettlement[] | null;
}

export interface EngineContextWiring {
  readonly onReservationRelease: (record: {
    readonly reservationId: string;
    readonly allocationSequence: number;
    readonly epoch: number;
    readonly issuer: SimulatorIssuer;
    readonly causationId: string | null;
    readonly commandType: string;
    readonly outcomeSchemaId: string;
  }, outcome: JsonValue) => void;
  readonly onStreamItem: (streamId: string, item: JsonValue) => void;
  readonly onStreamTerminal: (streamId: string, terminal: SimulatorStreamTerminal) => void;
}

/**
 * Materializes one committed value as the immutable source shared by reducers,
 * selectors, lifecycle projections, replay, and the public snapshot surface.
 * State transitions replace this value; no committed container is mutated.
 */
export function freezeCommittedState(committed: CommittedState): CommittedState {
  return freezeJsonValue(committed as unknown as JsonValue) as unknown as CommittedState;
}

export function createEngineContext(
  options: SimulatorStateEngineOptions,
  wiring: EngineContextWiring,
): EngineContext {
  const scenario = Object.freeze({
    ...options.scenario,
    scenarioState: freezeJsonValue(cloneJsonValue(options.scenario.scenarioState)),
    ecosystemState: freezeJsonValue(cloneJsonValue(options.scenario.ecosystemState)),
    shellState: freezeJsonValue(cloneJsonValue(options.scenario.shellState)),
  });
  const context: EngineContext = {
    hooks: options.hooks ?? {},
    wiring,
    maxOperationsPerDrain: options.maxOperationsPerDrain ?? SIMULATOR_MAX_OPERATIONS_PER_DRAIN,
    scenario,
    catalog: createOperationCatalog(),
    moduleCatalogs: new Map(),
    moduleBehaviors: new Map(),
    streamMethods: new Map(),
    loadedModules: new Set(),
    phase: 'open',
    epoch: 1,
    allocators: createEpochAllocators(),
    queue: [],
    draining: false,
    callbackRunning: false,
    operationsThisDrain: 0,
    settlements: [],
    terminalError: null,
    capabilities: new Set(),
    stateSubscribers: [],
    eventSubscribers: [],
    prepareWindows: new Map(),
    stateSubscriberSequence: 0,
    eventLog: [],
    replayInputs: [],
    replayReservationHandles: new Map(),
    replayExternalOperations: new Map(),
    replayAcceptanceOrder: 0,
    replayOperationSettlements: [],
    reservationResultSinks: new Map(),
    committed: freezeCommittedState({
      snapshot: {
        scenario: scenario.scenarioState,
        ecosystem: scenario.ecosystemState,
        shell: scenario.shellState,
        instances: {},
        modules: {},
      },
      revision: 0,
      random: simulatorRandomToSnapshot(decodeSimulatorSeed(scenario.seed)),
      logicalTime: scenario.initialLogicalTime,
    }),
    clock: createLogicalClock(scenario.initialLogicalTime),
    streams: createStreamRegistry({
      onItem: wiring.onStreamItem,
      onTerminal: wiring.onStreamTerminal,
    }),
    streamHandles: new Map(),
    pump: createAsyncReservationPump({
      onRelease: wiring.onReservationRelease,
    }),
    resetContext: null,
    resetTerminalCapture: null,
  };
  return context;
}

export function recordSettlement(
  context: EngineContext,
  sequence: number,
  settle: (result: SimulatorResult<JsonValue>) => void,
  result: SimulatorResult<JsonValue>,
): void {
  const replay = context.replayExternalOperations.get(sequence);
  if (replay) {
    context.replayExternalOperations.delete(sequence);
    context.replayOperationSettlements.push(Object.freeze({
      acceptanceOrder: replay.acceptanceOrder,
      acceptanceSequence: sequence,
      operationId: replay.operationId,
      result: freezeJsonValue(cloneJsonValue(assertJsonValue(result as unknown as JsonValue))) as unknown as SimulatorResult<JsonValue>,
    }));
  }
  context.settlements.push({ sequence, settle, result });
}

export function flushSettlements(context: EngineContext): void {
  const pending = context.settlements;
  context.settlements = [];
  pending.sort((left, right) => left.sequence - right.sequence);
  for (const entry of pending) entry.settle(entry.result);
}

export function partitionsView(context: EngineContext): SimulatorSnapshotPartitions {
  return Object.freeze({
    scenario: context.committed.snapshot.scenario,
    ecosystem: context.committed.snapshot.ecosystem,
    shell: context.committed.snapshot.shell,
    instances: context.committed.snapshot.instances as unknown as JsonValue,
    modules: context.committed.snapshot.modules as unknown as JsonValue,
  });
}

export function sharedProjectionFor(context: EngineContext, moduleId: string): JsonValue {
  const declaration = context.moduleCatalogs.get(moduleId);
  if (declaration?.selectSharedProjection) {
    return freezeJsonValue(assertJsonValue(declaration.selectSharedProjection(partitionsView(context))));
  }
  return context.committed.snapshot.ecosystem;
}

export function digestCommitted(context: EngineContext): string {
  return `sha256:${sha256HexOfText(canonicalizeJson({
    snapshot: {
      scenario: context.committed.snapshot.scenario,
      ecosystem: context.committed.snapshot.ecosystem,
      shell: context.committed.snapshot.shell,
      instances: context.committed.snapshot.instances as unknown as JsonValue,
      modules: context.committed.snapshot.modules as unknown as JsonValue,
    },
    revision: context.committed.revision,
    logicalTime: context.committed.logicalTime,
    random: {
      generator: context.committed.random.generator,
      state: [...context.committed.random.state],
      drawCount: context.committed.random.drawCount,
    },
  }))}`;
}

export function digestEvents(context: EngineContext): string {
  return `sha256:${sha256HexOfText(canonicalizeJson(context.eventLog as unknown as JsonValue))}`;
}

export function instancesInCreationOrder(committed: CommittedState) {
  return Object.freeze(Object.entries(committed.snapshot.instances)
    .map(([instanceId, instance]) => freezeInstancePresentation(instanceId, instance))
    .sort((left, right) => left.creationSequence - right.creationSequence));
}
