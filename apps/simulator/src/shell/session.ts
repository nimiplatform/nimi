/**
 * Simulator Shell session composition: one State Engine, one instance host,
 * one diagnostics store, and the Shell-owned route surface — wired behind
 * injected browser ports so the session is fully testable outside a browser.
 *
 * Authority: P-SIM-001, P-SIM-013, P-SIM-017; simulator-protocol.md §7/§10.
 */

import {
  createSimulatorStateEngine,
  type SimulatorStateEngine,
} from '../state-engine/engine.ts';
import { simulatorError, simulatorFail, simulatorOk, type SimulatorResult } from '../state-engine/errors.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import {
  createSimulatorInstanceHost,
  type SimulatorInstanceHost,
  type SimulatorInstanceHostOptions,
  type SimulatorPreparedSurfaceHost,
  type SimulatorRendererModuleSource,
} from '../lifecycle/instance-host.ts';
import type { SimulatorHostTimers } from '../lifecycle/cleanup-registry.ts';
import {
  createReadinessBarrier,
  type SimulatorReadinessBarrier,
  type SimulatorReadinessBrowserPort,
  type SimulatorReadinessDeclaration,
  type SimulatorReadinessExpectation,
} from '../lifecycle/readiness.ts';
import {
  createDiagnosticsStore,
  simulatorErrorScope,
  type SimulatorDiagnostic,
  type SimulatorDiagnosticsStore,
} from './diagnostics.ts';
import {
  parseShellRoute,
  serializeShellRoute,
  type SimulatorShellRoute,
} from './routes.ts';

export interface SimulatorRegistryModuleRow {
  readonly metadata: {
    readonly moduleId: string;
    readonly orderingKey: number;
    readonly surfaces: readonly {
      readonly id: string;
      readonly label: string;
      readonly initialRoute: string;
      readonly readinessContractId: string;
    }[];
    readonly requirements: {
      readonly kitCapabilities: readonly string[];
      readonly sdkMethods: readonly string[];
      readonly commands: readonly string[];
      readonly events: readonly string[];
    };
  };
  readonly loadRenderer: () => Promise<unknown>;
  readonly loadAdapter: () => Promise<unknown>;
  readonly loadStyle: () => Promise<unknown>;
}

export interface SimulatorSessionOptions {
  readonly scenario: Parameters<typeof createSimulatorStateEngine>[0]['scenario'];
  readonly registryModules: readonly SimulatorRegistryModuleRow[];
  readonly moduleCatalogs: readonly Parameters<SimulatorStateEngine['registerModuleCatalog']>[0][];
  readonly timers: SimulatorHostTimers;
  readonly effectScope: SimulatorInstanceHostOptions['effectScope'];
  readonly prepareSurface: (input: {
    readonly engine: SimulatorStateEngine;
    readonly moduleId: string;
    readonly instanceId: string;
    readonly surfaceId: string;
    readonly readinessContractId: string;
    readonly kitCapabilities: readonly string[];
    readonly failInstance: (instanceId: string, cause: string) => void;
  }) => SimulatorPreparedSurfaceHost;
  readonly readinessBrowser: SimulatorReadinessBrowserPort;
  readonly commitToken: () => number;
  readonly simulationDisclosureVisible: () => boolean;
  /** Keys are `<moduleId>/<surfaceId>` and must exist for every mounted surface. */
  readonly readinessDeclarations?: Readonly<Record<string, SimulatorReadinessDeclaration>>;
  readonly readinessExpectations?: Readonly<Record<string, SimulatorReadinessExpectation>>;
  readonly readinessProjectionPredicates?: Readonly<Record<string, (projection: JsonValue) => boolean>>;
  readonly readinessBlockingPredicates?: Readonly<Record<string, () => boolean>>;
}

export interface SimulatorSessionInstanceView {
  readonly instanceId: string;
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly status: string;
  readonly readiness: string;
}

export interface SimulatorSession {
  readonly engine: SimulatorStateEngine;
  readonly diagnostics: SimulatorDiagnosticsStore;
  openInstance(
    moduleId: string,
    surfaceId?: string,
    options?: { readonly activateBeforeMount?: boolean },
  ): Promise<SimulatorResult<{ readonly instanceId: string }>>;
  closeInstance(instanceId: string): Promise<SimulatorResult<{ readonly disposed: boolean }>>;
  activateInstance(instanceId: string): Promise<SimulatorResult<{ readonly activated: boolean }>>;
  deactivateInstance(instanceId: string): Promise<SimulatorResult<{ readonly deactivated: boolean }>>;
  resetScenario(): Promise<SimulatorResult<JsonValue>>;
  route(): SimulatorShellRoute;
  navigate(route: SimulatorShellRoute): void;
  instances(): readonly SimulatorSessionInstanceView[];
  readinessFor(instanceId: string, surfaceId: string): SimulatorResult<SimulatorReadinessBarrier>;
  /** Last digest published at a completed visible-checkpoint boundary. */
  replayDigest(): string | null;
  subscribe(listener: () => void): () => void;
  readonly phase: 'open' | 'resetting' | 'terminal';
  readonly epoch: number;
}

export function createSimulatorSession(options: SimulatorSessionOptions): SimulatorSession {
  const listeners = new Set<() => void>();
  const diagnostics = createDiagnosticsStore();
  const readinessBarriers = new Map<string, SimulatorReadinessBarrier>();
  const resetReadinessSettlements: { readonly sequence: number; readonly settle: () => void }[] = [];
  const hostRef: { current: SimulatorInstanceHost | null } = { current: null };
  let currentRoute: SimulatorShellRoute = { kind: 'home' };
  let publishedReplayDigest: string | null = null;

  const engine = createSimulatorStateEngine({
    scenario: options.scenario,
    hooks: {
      requestInstanceFailure(instanceId, cause) {
        hostRef.current?.failInstance(instanceId, cause);
      },
      invalidateEpoch(oldEpoch) {
        hostRef.current?.invalidateEpoch(oldEpoch);
        let sequence = 0;
        for (const barrier of readinessBarriers.values()) {
          if (oldEpoch === engine.epoch) {
            barrier.cancel('session-failure');
            continue;
          }
          sequence += 1;
          const deferred = barrier.beginResetCancellation();
          if (deferred) resetReadinessSettlements.push({ sequence, settle: deferred.settle });
        }
      },
      disposeInstancesForReset(instances) {
        return hostRef.current?.disposeAllForReset(instances) ?? Promise.resolve();
      },
      collectResetTerminalSettlements(record) {
        for (const settlement of resetReadinessSettlements.splice(0)) {
          record('readiness', settlement.sequence, settlement.settle);
        }
        hostRef.current?.collectResetTerminalSettlements((sequence, settle) => {
          record('lifecycle', sequence, settle);
        });
      },
      onSessionTerminal(error) {
        if (simulatorErrorScope(error.code) === 'session') {
          diagnostics.reportSessionFailure(error, engine.epoch);
        }
        for (const barrier of readinessBarriers.values()) {
          barrier.cancel('session-failure');
        }
        notify();
      },
    },
  });
  for (const declaration of options.moduleCatalogs) {
    engine.registerModuleCatalog(declaration);
  }

  const host = createSimulatorInstanceHost({
    engine,
    timers: options.timers,
    effectScope: options.effectScope,
    prepareSurface(input) {
      const row = options.registryModules.find((entry) => entry.metadata.moduleId === input.moduleId);
      const surface = row?.metadata.surfaces.find((entry) => entry.id === input.surfaceId);
      if (!row || !surface) throw new Error('SIMULATOR_REGISTRY_SURFACE_MISSING');
      return options.prepareSurface({
        engine,
        ...input,
        readinessContractId: surface.readinessContractId,
        kitCapabilities: row.metadata.requirements.kitCapabilities,
        failInstance(instanceId, cause) {
          hostRef.current?.failInstance(instanceId, cause);
        },
      });
    },
    onSessionIntegrityFailure(error) {
      void error;
      notify();
    },
    onInstanceFailed(instanceId, error) {
      const readinessReason = simulatorErrorScope(error.code) === 'module'
        ? 'module-failure'
        : 'instance-failure';
      if (simulatorErrorScope(error.code) === 'module') {
        diagnostics.reportModuleFailure(error, engine.epoch);
      } else {
        diagnostics.reportInstanceFailure(error, engine.epoch);
      }
      for (const [key, barrier] of readinessBarriers) {
        if (key.startsWith(`${instanceId}\u0000`)) barrier.cancel(readinessReason);
      }
      notify();
    },
    onInstanceDisposed(instanceId) {
      diagnostics.removeForInstance(instanceId);
      for (const key of readinessBarriers.keys()) {
        if (key.startsWith(`${instanceId}\u0000`)) readinessBarriers.delete(key);
      }
      notify();
    },
  });
  hostRef.current = host;

  engine.subscribeState(() => notify());

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function registryRow(moduleId: string): SimulatorRegistryModuleRow | null {
    return options.registryModules.find((row) => row.metadata.moduleId === moduleId) ?? null;
  }

  const session: SimulatorSession = {
    engine,
    diagnostics,
    async openInstance(moduleId, surfaceId = 'main', openOptions = {}) {
      if (engine.phase === 'terminal') {
        return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId }));
      }
      const row = registryRow(moduleId);
      if (!row) {
        return simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', { moduleId }));
      }
      const surface = row.metadata.surfaces.find((entry) => entry.id === surfaceId);
      if (!surface) {
        return simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', { moduleId }));
      }
      const opened = await host.openInstance({
        moduleId,
        surfaceId,
        initialRoute: { pathname: surface.initialRoute, search: [], fragment: null },
        activateBeforeMount: openOptions.activateBeforeMount === true,
        loadRenderer: async () => await row.loadRenderer() as SimulatorRendererModuleSource,
        loadAdapter: async () => row.loadAdapter(),
        loadStyle: async () => row.loadStyle(),
      });
      notify();
      return opened;
    },
    closeInstance(instanceId) {
      for (const [key, barrier] of readinessBarriers) {
        if (key.startsWith(`${instanceId}\u0000`)) barrier.cancel('dispose');
      }
      return host.disposeInstance(instanceId);
    },
    activateInstance(instanceId) {
      return host.activateInstance(instanceId);
    },
    deactivateInstance(instanceId) {
      return host.deactivateInstance(instanceId);
    },
    resetScenario() {
      const pending = engine.acceptCommand('simulator.reset', {}, {
        kind: 'scenario',
        moduleId: null,
        instanceId: null,
      });
      // Return the State Engine's settlement Promise itself. Wrapping it in an
      // async function inserts an extra Promise-adoption turn, which lets
      // readiness terminal observers run before the reset result even though
      // the engine resolves them in the required order.
      void pending.then((result) => {
        if (result.ok) {
          readinessBarriers.clear();
          currentRoute = { kind: 'home' };
          publishedReplayDigest = null;
        }
        notify();
      });
      return pending;
    },
    route() {
      return currentRoute;
    },
    navigate(route) {
      currentRoute = route;
      notify();
    },
    instances() {
      const committed = engine.getCommitted();
      const shell = committed.partitions.shell as Readonly<Record<string, JsonValue>>;
      const readiness = shell.readiness && typeof shell.readiness === 'object' && !Array.isArray(shell.readiness)
        ? shell.readiness as Readonly<Record<string, JsonValue>>
        : {};
      return committed.instancesInCreationOrder().map((instance) => {
        const readinessState = Object.values(readiness).find((entry) => {
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
          const record = entry as Readonly<Record<string, JsonValue>>;
          return record.instanceId === instance.instanceId && record.surfaceId === instance.surfaceId;
        });
        const readinessRecord = readinessState !== null && typeof readinessState === 'object' && !Array.isArray(readinessState)
          ? readinessState as Readonly<Record<string, JsonValue>>
          : null;
        const readinessBarrier = readinessBarriers.get(`${instance.instanceId}\u0000${instance.surfaceId}`);
        return {
          instanceId: instance.instanceId,
          moduleId: instance.moduleId,
          surfaceId: instance.surfaceId,
          status: instance.status,
          readiness: readinessRecord && typeof readinessRecord.state === 'string'
            ? readinessRecord.state
            : readinessBarrier?.state ?? 'pending',
        };
      });
    },
    readinessFor(instanceId, surfaceId) {
      const instance = engine.getCommitted().instance(instanceId);
      if (!instance) {
        return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { instanceId }));
      }
      if (instance.surfaceId !== surfaceId) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId }));
      }
      const barrierKey = `${instanceId}\u0000${surfaceId}`;
      const existing = readinessBarriers.get(barrierKey);
      if (existing) return simulatorOk(existing);
      const contractKey = `${instance.moduleId}/${surfaceId}`;
      const declaration = options.readinessDeclarations?.[contractKey];
      const expectation = options.readinessExpectations?.[contractKey];
      const projectionPredicate = expectation
        ? options.readinessProjectionPredicates?.[expectation.projectionPredicateId]
        : undefined;
      const blockingPredicate = expectation
        ? options.readinessBlockingPredicates?.[expectation.blockingStatePredicateId]
        : undefined;
      if (!declaration || !expectation || !projectionPredicate || !blockingPredicate) {
        const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
          moduleId: instance.moduleId,
          instanceId,
        });
        engine.terminateIntegrity(error);
        return simulatorFail(error);
      }
      const barrier = createReadinessBarrier({
        engine,
        instanceId,
        surfaceId,
        epoch: engine.epoch,
        declaration,
        expectation,
        browser: options.readinessBrowser,
        projectionPredicate,
        blockingPredicate,
        commitToken: options.commitToken,
        projection: () => {
          const projected = engine.projectInstance(instanceId);
          return projected.ok ? projected.value : null;
        },
        simulationDisclosureVisible: options.simulationDisclosureVisible,
        onStateChange: notify,
      });
      readinessBarriers.set(barrierKey, barrier);
      void barrier.completion.then(() => {
        if (engine.phase === 'open' && engine.isQuiescent()) {
          publishedReplayDigest = engine.replayRecordDigest();
        }
        notify();
      });
      return simulatorOk(barrier);
    },
    replayDigest() {
      return publishedReplayDigest;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get phase() {
      return engine.phase;
    },
    get epoch() {
      return engine.epoch;
    },
  };

  return session;
}

export { parseShellRoute, serializeShellRoute };
export type { SimulatorDiagnostic };
