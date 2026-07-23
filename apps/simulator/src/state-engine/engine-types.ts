/**
 * Shared Simulator State Engine internal types and constants.
 *
 * Authority: P-SIM-010..015, P-SIM-019;
 * tables/simulator-state-engine-policy.yaml.
 */

import type { JsonValue } from './json-value.ts';
import type { SimulatorError, SimulatorResult } from './errors.ts';
import type { SimulatorSchema } from './schema.ts';
import type { SimulatorRandomSnapshotV1 } from './random.ts';
import type {
  SimulatorEventRecord,
  SimulatorInstancePresentation,
  SimulatorIssuer,
  SimulatorModuleBehavior,
  SimulatorModuleCatalogDeclaration,
  SimulatorRouteState,
  SimulatorScenarioDeclaration,
  SimulatorSnapshotPartitions,
} from './types.ts';

export const SIMULATOR_MAX_OPERATIONS_PER_DRAIN = 10000;

export const INTERNAL = {
  clockAdvanceBy: 'simulator.clock.advanceBy',
  clockAdvanceTo: 'simulator.clock.advanceTo',
  clockSchedule: 'simulator.clock.schedule',
  clockCancelJob: 'simulator.clock.cancelJob',
  streamOpen: 'simulator.stream.open',
  streamActivate: 'simulator.stream.activate',
  streamCancel: 'simulator.stream.cancel',
  behaviorActivate: 'simulator.behavior.activate',
  instanceOpen: 'simulator.instance.open',
  instanceTransition: 'simulator.instance.transition',
  instanceDisposed: 'simulator.instance.disposed',
  instanceRoute: 'simulator.instance.route',
  overlayAcquire: 'simulator.overlay.acquire',
  overlayDismiss: 'simulator.overlay.dismiss',
  overlayBeginRelease: 'simulator.overlay.beginRelease',
  overlayReleased: 'simulator.overlay.released',
  readinessSettle: 'simulator.readiness.settle',
  reset: 'simulator.reset',
} as const;

export const QUERY_COMMITTED = 'simulator.query.committed';

export const INSTANCE_STATUSES = [
  'closed',
  'loading',
  'preparing',
  'inactive',
  'active',
  'disposing',
  'disposed',
  'failed',
] as const;

export type SimulatorInstanceStatus = (typeof INSTANCE_STATUSES)[number];

/** Closed lifecycle transition table (tables/simulator-state-engine-policy.yaml). */
export const INSTANCE_TRANSITIONS: Readonly<Record<string, SimulatorInstanceStatus>> = Object.freeze({
  'closed:open': 'loading',
  'loading:module_loaded': 'preparing',
  'loading:attributable_failure': 'failed',
  'loading:dispose': 'disposing',
  'preparing:prepare_success': 'inactive',
  'preparing:attributable_failure': 'failed',
  'preparing:dispose': 'disposing',
  'inactive:activate': 'active',
  'active:deactivate': 'inactive',
  'inactive:attributable_failure': 'failed',
  'active:attributable_failure': 'failed',
  'inactive:dispose': 'disposing',
  'active:dispose': 'disposing',
  'failed:dispose': 'disposing',
  'disposing:disposed': 'disposed',
});

export interface MutableInstanceState {
  moduleId: string;
  surfaceId: string;
  status: SimulatorInstanceStatus;
  creationSequence: number;
  route: SimulatorRouteState;
  presentation: JsonValue;
}

export interface QueuedOperation {
  readonly operationId: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly kind: 'command' | 'query';
  readonly type: string;
  readonly payload: JsonValue;
  readonly issuer: SimulatorIssuer;
  readonly causationId: string | null;
  readonly derived: boolean;
  readonly settle: (result: SimulatorResult<JsonValue>) => void;
}

export interface SettlementRecord {
  readonly sequence: number;
  readonly settle: (result: SimulatorResult<JsonValue>) => void;
  readonly result: SimulatorResult<JsonValue>;
}

export interface EventSubscriber {
  readonly eventType: string;
  readonly subscriberModuleId: string;
  readonly subscriberInstanceId: string | null;
  readonly moduleOrderingKey: number;
  readonly instanceCreationSequence: number;
  readonly subscriptionSequence: number;
  readonly handler: (payload: JsonValue, event: SimulatorEventRecord) => unknown;
}

export interface SimulatorPrepareWindow {
  readonly instanceId: string;
  close(): void;
  readonly closed: boolean;
}

export interface SimulatorStreamHandle {
  readonly streamId: string;
  attach(observer: (item: JsonValue) => unknown): SimulatorResult<{ readonly attached: boolean }>;
  readonly completion: Promise<SimulatorStreamTerminal>;
}

export interface SimulatorStreamMethodDeclaration {
  readonly methodId: string;
  readonly ownerModuleId: string;
  readonly sourceEventType: string;
  readonly terminalEventType: string | null;
  readonly itemSchema: SimulatorSchema;
  readonly terminalSchema: SimulatorSchema;
}

export interface SimulatorResetTerminalSettlement {
  readonly kind: 'stream' | 'reservation' | 'readiness' | 'lifecycle';
  readonly sequence: number;
  readonly settle: () => void;
}

export interface SimulatorStateEngineHooks {
  /** Synchronous old-epoch token invalidation at reset linearization. */
  invalidateEpoch?(oldEpoch: number, newEpoch: number): void;
  /** Async ordered instance cleanup for the reset barrier (reverse creation order). */
  disposeInstancesForReset?(instances: readonly SimulatorInstancePresentation[]): Promise<void>;
  /** Terminal session integrity failure notification. */
  onSessionTerminal?(error: SimulatorError): void;
  /** Attributable App callback fault: fail one instance after ordered cleanup. */
  requestInstanceFailure?(instanceId: string, cause: string): void;
  /** Collect readiness/lifecycle terminal settlements during the reset barrier. */
  collectResetTerminalSettlements?(
    record: (kind: 'readiness' | 'lifecycle', sequence: number, settle: () => void) => void,
  ): void;
}

export interface SimulatorReplayInputEntry {
  readonly kind: 'operation';
  readonly operation: {
    readonly kind: 'command' | 'query';
    readonly type: string;
    readonly payload: JsonValue;
    readonly issuer: SimulatorIssuer;
    readonly causationId: string | null;
  };
}

export interface SimulatorReplayReservationAllocationEntry {
  readonly kind: 'reservation-allocate';
  readonly allocation: {
    readonly reservationId: string;
    readonly epoch: number;
    readonly allocationSequence: number;
    readonly issuer: SimulatorIssuer;
    readonly causationId: string | null;
    readonly commandType: string;
    readonly outcomeSchemaId: string;
  };
}

export interface SimulatorReplayReservationTerminalEntry {
  readonly kind: 'reservation-terminal';
  readonly reservation: {
    readonly reservationId: string;
    readonly epoch: number;
    readonly allocationSequence: number;
    readonly resolution: 'settled' | 'cancelled';
    readonly outcome: JsonValue | null;
    readonly cancelReason: 'caller' | 'dispose' | 'reset' | null;
  };
}

export interface SimulatorReplayStreamAllocationEntry {
  readonly kind: 'stream-allocate';
  readonly stream: {
    readonly streamId: string;
    readonly epoch: number;
    readonly allocationSequence: number;
    readonly methodId: string;
    readonly ownerModuleId: string;
    readonly ownerInstanceId: string | null;
  };
}

export interface SimulatorReplayStreamTerminalEntry {
  readonly kind: 'stream-terminal';
  readonly stream: {
    readonly streamId: string;
    readonly epoch: number;
    readonly allocationSequence: number;
    readonly terminal: SimulatorStreamTerminal;
  };
}

export interface SimulatorReplayStreamAttachEntry {
  readonly kind: 'stream-attach';
  readonly stream: {
    readonly streamId: string;
    readonly epoch: number;
    readonly allocationSequence: number;
  };
}

export type SimulatorReplayLedgerEntry =
  | SimulatorReplayInputEntry
  | SimulatorReplayReservationAllocationEntry
  | SimulatorReplayReservationTerminalEntry
  | SimulatorReplayStreamAllocationEntry
  | SimulatorReplayStreamAttachEntry
  | SimulatorReplayStreamTerminalEntry;

export interface SimulatorReplayOperationSettlement {
  readonly acceptanceOrder: number;
  readonly acceptanceSequence: number;
  readonly operationId: string;
  readonly result: SimulatorResult<JsonValue>;
}

export interface SimulatorReplayRecord {
  readonly protocolRevision: 1;
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly seed: string;
  readonly initialLogicalTime: number;
  readonly moduleIds: readonly string[];
  readonly streamMethods: readonly import('./replay-identity.ts').SimulatorReplayStreamMethodIdentity[];
  readonly inputs: readonly SimulatorReplayLedgerEntry[];
  readonly operationSettlements: readonly SimulatorReplayOperationSettlement[];
  readonly expected: {
    readonly epoch: number;
    readonly revision: number;
    readonly logicalTime: number;
    readonly random: SimulatorRandomSnapshotV1;
    readonly stateDigest: string;
    readonly eventDigest: string;
  };
}

export interface CommittedState {
  snapshot: {
    scenario: JsonValue;
    ecosystem: JsonValue;
    shell: JsonValue;
    instances: Record<string, MutableInstanceState>;
    modules: Record<string, JsonValue>;
  };
  revision: number;
  random: SimulatorRandomSnapshotV1;
  logicalTime: number;
}

export interface SimulatorStateEngineOptions {
  readonly scenario: SimulatorScenarioDeclaration;
  readonly interactions?: readonly import('./interactions.ts').SimulatorInteractionDeclaration[];
  readonly hooks?: SimulatorStateEngineHooks;
  readonly maxOperationsPerDrain?: number;
}

export interface SimulatorStateEngine {
  readonly epoch: number;
  readonly phase: 'open' | 'resetting' | 'terminal';
  /** Host-integrity escape hatch; idempotently terminates the whole session. */
  terminateIntegrity(error: SimulatorError): void;
  /** Registers qualified operation metadata without importing App code. */
  registerModuleCatalog(declaration: SimulatorModuleCatalogDeclaration): void;
  /** Binds the lazily loaded App behavior exactly once before activation. */
  attachModuleBehavior(
    moduleId: string,
    behavior: SimulatorModuleBehavior,
  ): SimulatorResult<{ readonly attached: true }>;
  /** Computes one pure, instance-scoped App projection without mutating state. */
  projectInstance(instanceId: string): SimulatorResult<JsonValue>;
  registerStreamMethod(declaration: SimulatorStreamMethodDeclaration): void;
  setCapabilities(capabilities: ReadonlySet<string>): void;
  acceptCommand(
    type: string,
    payload: JsonValue,
    issuer: SimulatorIssuer,
    causationId?: string | null,
    options?: { readonly derived?: boolean },
  ): Promise<SimulatorResult<JsonValue>>;
  acceptQuery(type: string, input: JsonValue, issuer: SimulatorIssuer): Promise<SimulatorResult<JsonValue>>;
  reserveAsync(input: {
    readonly issuer: SimulatorIssuer;
    readonly causationId: string | null;
    readonly commandType: string;
    /** Evidence identity of the captured command-payload schema. */
    readonly outcomeSchemaId: string;
    readonly onCommandSettlement?: ((result: SimulatorResult<JsonValue>) => void) | null;
  }): SimulatorResult<SimulatorAsyncReservationHandle>;
  /** Lifecycle-owned synchronous invalidation before observable disposal. */
  cancelAsyncReservationsForInstance(instanceId: string): void;
  /** Lifecycle-owned stream terminalization before abort callbacks run. */
  cancelStreamsForInstance(instanceId: string): void;
  subscribeState(listener: (revision: number) => unknown): () => void;
  beginPrepareWindow(instanceId: string): SimulatorResult<SimulatorPrepareWindow>;
  subscribeEvent(
    window: SimulatorPrepareWindow,
    eventType: string,
    handler: (payload: JsonValue, event: SimulatorEventRecord) => unknown,
  ): SimulatorResult<() => void>;
  attachStream(streamId: string): SimulatorResult<{ readonly attached: boolean }>;
  streamObserverFailure(streamId: string): void;
  /** Low-level stream handle: paused until activation; one observer only. */
  streamHandle(streamId: string): SimulatorStreamHandle | null;
  getCommitted(): {
    readonly epoch: number;
    readonly revision: number;
    readonly logicalTime: number;
    readonly random: SimulatorRandomSnapshotV1;
    readonly partitions: SimulatorSnapshotPartitions;
    readonly instance: (instanceId: string) => SimulatorInstancePresentation | null;
    readonly instancesInCreationOrder: () => readonly SimulatorInstancePresentation[];
  };
  isQuiescent(): boolean;
  buildReplayRecord(): SimulatorReplayRecord;
  replayRecordDigest(record?: SimulatorReplayRecord): string;
  applyReplayReservationTerminal(
    reservationId: string,
    resolution: 'settled' | 'cancelled',
    outcome: JsonValue | null,
    cancelReason: 'caller' | 'dispose' | 'reset' | null,
  ): void;
  /** Allocates one canonical readiness identifier in the current epoch. */
  allocateReadinessId(): SimulatorResult<{ readonly readinessId: string }>;
  // Internal surface for the replay runner and tests.
  readonly streamRegistry: SimulatorStreamRegistry;
}

import type { SimulatorAsyncReservationHandle } from './reservations.ts';
import type { SimulatorStreamRegistry, SimulatorStreamTerminal } from './streams.ts';

export class SimulatorIntegrityAbort extends Error {
  readonly error: SimulatorError;
  constructor(error: SimulatorError) {
    super(error.message);
    this.name = 'SimulatorIntegrityAbort';
    this.error = error;
  }
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

export function freezeInstancePresentation(instanceId: string, instance: {
  moduleId: string;
  surfaceId: string;
  status: string;
  creationSequence: number;
  route: SimulatorRouteState;
  presentation: JsonValue;
}): SimulatorInstancePresentation {
  return Object.freeze({
    instanceId,
    moduleId: instance.moduleId,
    surfaceId: instance.surfaceId,
    status: instance.status,
    creationSequence: instance.creationSequence,
    route: instance.route,
    presentation: instance.presentation,
  });
}
