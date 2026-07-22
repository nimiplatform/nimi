/**
 * Public host/Adapter lifecycle types for one Simulator renderer instance.
 *
 * Authority: P-SIM-006, P-SIM-007, P-SIM-013, P-SIM-019.
 */

import type {
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

import type { SimulatorError, SimulatorResult } from '../state-engine/errors.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type {
  SimulatorEventRecord,
  SimulatorModuleBehavior,
  SimulatorRouteState,
} from '../state-engine/types.ts';
import type { SimulatorCleanupController, SimulatorHostTimers } from './cleanup-registry.ts';
import type {
  SimulatorCanonicalInstance,
  SimulatorCanonicalRendererBindings,
} from './renderer-contract.ts';

export interface SimulatorAdapterFactorySource {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly behavior: SimulatorModuleBehavior;
  create(): SimulatorAdapterInstance;
}

export interface SimulatorAdapterInstance {
  prepare(
    context: SimulatorAdapterPrepareContext,
  ): Promise<SimulatorCanonicalRendererBindings> | SimulatorCanonicalRendererBindings;
  activate(): Promise<void> | void;
  deactivate(): Promise<void> | void;
  dispose(): Promise<void> | void;
}

export interface SimulatorAdapterPrepareContext {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortSignal: AbortSignal;
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly commands: {
    invoke(type: string, payload: JsonValue): Promise<SimulatorResult<JsonValue>>;
  };
  readonly interactions: {
    emit(input: {
      readonly protocol: 'nimi.simulator.interaction/v1';
      readonly interactionId: string;
      readonly targets: readonly string[];
      readonly type: string;
      readonly payload: JsonValue;
    }): Promise<SimulatorResult<JsonValue>>;
  };
  readonly events: {
    subscribe(
      eventType: string,
      handler: (payload: JsonValue, event: SimulatorEventRecord) => unknown,
    ): SimulatorResult<() => void>;
  };
  readonly cleanup: SimulatorCleanupController['registry'];
  readonly projection: {
    get(): JsonValue;
    subscribe(listener: (value: JsonValue) => unknown): () => void;
  };
  readonly route: {
    get(): SimulatorRouteState;
    subscribe(listener: (route: SimulatorRouteState) => unknown): () => void;
    navigate(route: SimulatorRouteState): Promise<SimulatorResult<JsonValue>>;
  };
  readonly clock: {
    now(): number;
    schedule(command: { type: string; payload: JsonValue; causationId: string | null }, delayMs: number): Promise<SimulatorResult<JsonValue>>;
    cancel(jobId: string): Promise<SimulatorResult<JsonValue>>;
  };
  readonly asyncReservations: {
    reserve(input: {
      commandType: string;
      outcomeSchemaId: string;
      onCommandSettlement?: ((result: SimulatorResult<JsonValue>) => void) | null;
    }): SimulatorResult<{
      readonly reservationId: string;
      settle(outcome: JsonValue): SimulatorResult<{ readonly accepted: boolean }>;
      cancel(reason: 'caller' | 'dispose' | 'reset'): SimulatorResult<{ readonly cancelled: boolean }>;
    }>;
  };
}

export interface SimulatorPreparedSurfaceHost {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  mount(canonical: SimulatorCanonicalInstance): void;
  unmount(): Promise<void> | void;
}

export interface SimulatorInstanceHostOptions {
  readonly engine: SimulatorStateEngine;
  readonly timers: SimulatorHostTimers;
  readonly effectScope: {
    run<T>(
      owner: 'app-adapter' | 'canonical-renderer',
      phase: 'instance-lifecycle' | 'callback',
      callback: () => T,
    ): T;
  };
  readonly watchdogMs?: number;
  readonly onSessionIntegrityFailure: (error: SimulatorError) => void;
  readonly onInstanceFailed?: (instanceId: string, diagnostic: SimulatorError) => void;
  readonly onInstanceDisposed?: (instanceId: string) => void;
  readonly prepareSurface: (input: {
    readonly moduleId: string;
    readonly instanceId: string;
    readonly surfaceId: string;
  }) => SimulatorPreparedSurfaceHost;
}

export type SimulatorHostPhase = 'loading' | 'preparing' | 'ready' | 'disposing' | 'disposed' | 'failed';

export interface SimulatorOpenInstanceInput {
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly initialRoute: SimulatorRouteState;
  /** Scenario/Shell intent applied before the canonical surface may render. */
  readonly activateBeforeMount?: boolean;
  readonly loadRenderer: () => Promise<unknown>;
  readonly loadAdapter: () => Promise<unknown>;
  readonly loadStyle: () => Promise<unknown>;
}

export interface SimulatorInstanceHost {
  openInstance(input: SimulatorOpenInstanceInput): Promise<SimulatorResult<{ readonly instanceId: string }>>;
  activateInstance(instanceId: string): Promise<SimulatorResult<{ readonly activated: boolean }>>;
  deactivateInstance(instanceId: string): Promise<SimulatorResult<{ readonly deactivated: boolean }>>;
  disposeInstance(instanceId: string): Promise<SimulatorResult<{ readonly disposed: boolean }>>;
  failInstance(instanceId: string, cause: string): void;
  invalidateEpoch(oldEpoch: number): void;
  disposeAllForReset(instances: readonly { readonly instanceId: string }[]): Promise<void>;
  collectResetTerminalSettlements(record: (sequence: number, settle: () => void) => void): void;
  phaseOf(instanceId: string): SimulatorHostPhase | null;
  hasLiveResources(instanceId: string): boolean;
}
