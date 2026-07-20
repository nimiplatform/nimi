/**
 * Shared State Engine protocol types.
 *
 * Authority: simulator-protocol.md §3, §9, §11 and
 * tables/simulator-state-engine-policy.yaml.
 */

import type { JsonValue } from './json-value.ts';
import type { SimulatorSchema } from './schema.ts';

export interface SimulatorIssuer {
  readonly kind: 'shell' | 'instance' | 'scenario';
  readonly moduleId: string | null;
  readonly instanceId: string | null;
}

export const SIMULATOR_SHELL_ISSUER: SimulatorIssuer = Object.freeze({
  kind: 'shell',
  moduleId: null,
  instanceId: null,
});

export const SIMULATOR_SCENARIO_ISSUER: SimulatorIssuer = Object.freeze({
  kind: 'scenario',
  moduleId: null,
  instanceId: null,
});

export function simulatorInstanceIssuer(moduleId: string, instanceId: string): SimulatorIssuer {
  return Object.freeze({ kind: 'instance', moduleId, instanceId });
}

export interface SimulatorCommandEnvelope {
  readonly protocol: 'nimi.simulator.operation/v1';
  readonly kind: 'command';
  readonly type: string;
  readonly payload: JsonValue;
  readonly epoch: number;
  readonly sequence: number;
  readonly operationId: string;
  readonly issuer: SimulatorIssuer;
  readonly causationId: string | null;
}

export interface SimulatorDeclaredEvent {
  readonly type: string;
  readonly payload: JsonValue;
}

export interface SimulatorEventRecord {
  readonly eventId: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly fullType: string;
  readonly ownerModuleId: string;
  readonly payload: JsonValue;
  readonly causationOperationId: string;
}

export interface SimulatorModuleInitialInput {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly moduleData: JsonValue;
  readonly sharedProjection: JsonValue;
}

export interface SimulatorReducerContext {
  readonly now: number;
  readonly sharedProjection: JsonValue;
  drawRandom(): number;
}

export interface SimulatorReduction {
  readonly state: JsonValue;
  readonly events: readonly SimulatorDeclaredEvent[];
}

export interface SimulatorModuleBehavior {
  initialState(input: SimulatorModuleInitialInput): JsonValue;
  reduce(
    state: JsonValue,
    envelope: SimulatorCommandEnvelope,
    context: SimulatorReducerContext,
  ): SimulatorReduction;
  project(state: JsonValue, instance: SimulatorProjectionInput): JsonValue;
}

export interface SimulatorProjectionInput {
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly route: SimulatorRouteState;
  readonly sharedProjection: JsonValue;
}

export interface SimulatorRouteSearchEntry {
  readonly key: string;
  readonly value: string;
}

export interface SimulatorRouteState {
  readonly pathname: string;
  readonly search: readonly SimulatorRouteSearchEntry[];
  readonly fragment: string | null;
}

/**
 * Simulator-owned, build-time declaration of the operations admitted for one
 * selected module. This value is data/configuration only: loading it must not
 * evaluate the App Adapter graph.
 */
export interface SimulatorModuleCatalogDeclaration {
  readonly moduleId: string;
  /** Registry ordering key: module target order for event delivery and reset reconstruction. */
  readonly orderingKey: number;
  /** Command type → payload schema owned by this module's reducer. */
  readonly commandSchemas: Readonly<Record<string, SimulatorSchema>>;
  /** Declared event type → payload schema. */
  readonly eventSchemas: Readonly<Record<string, SimulatorSchema>>;
  /** Declared read queries: type → input/projection schemas + selector. */
  readonly queries: Readonly<Record<string, SimulatorModuleQueryDeclaration>>;
  /** Declared shared projection read by reducers of this module. */
  readonly selectSharedProjection?: ((partitions: SimulatorSnapshotPartitions) => JsonValue) | null;
  /** Scenario-provided initial module data. */
  readonly moduleData: JsonValue;
}

/**
 * Complete deterministic definition used only by offline replay/test runners.
 * Product sessions register `catalog` eagerly and attach `behavior` lazily.
 */
export interface SimulatorModuleDefinition extends SimulatorModuleCatalogDeclaration {
  readonly behavior: SimulatorModuleBehavior;
}

export interface SimulatorModuleQueryDeclaration {
  readonly inputSchema: SimulatorSchema;
  readonly projectionSchema: SimulatorSchema;
  readonly select: (moduleState: JsonValue, input: JsonValue) => JsonValue;
}

export interface SimulatorSnapshotPartitions {
  readonly scenario: JsonValue;
  readonly ecosystem: JsonValue;
  readonly shell: JsonValue;
  readonly instances: JsonValue;
  readonly modules: JsonValue;
}

export interface SimulatorScenarioDeclaration {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  /** Exactly 64 lowercase hexadecimal characters; never all zero. */
  readonly seed: string;
  readonly initialLogicalTime: number;
  readonly scenarioState: JsonValue;
  readonly ecosystemState: JsonValue;
  readonly shellState: JsonValue;
}

export interface SimulatorInstancePresentation {
  readonly instanceId: string;
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly status: string;
  readonly creationSequence: number;
  readonly route: SimulatorRouteState;
  readonly presentation: JsonValue;
}

export const SIMULATOR_PROTOCOL_OPERATION = 'nimi.simulator.operation/v1' as const;
export const SIMULATOR_PROTOCOL_MODULE = 'nimi.simulator.module/v1' as const;
export const SIMULATOR_PROTOCOL_INTERACTION = 'nimi.simulator.interaction/v1' as const;
