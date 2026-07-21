/**
 * Serialized instance lifecycle, the sole close-during-prepare interrupt,
 * exact cleanup order, and the host-integrity watchdog. Renderer semantics
 * stay injected. Authority: P-SIM-013/P-SIM-019 and instance_lifecycle policy.
 */

import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorError,
  type SimulatorResult,
} from '../state-engine/errors.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorPrepareWindow } from '../state-engine/engine.ts';
import type {
  SimulatorModuleBehavior,
} from '../state-engine/types.ts';
import {
  createCleanupRegistry,
  SIMULATOR_CLEANUP_WATCHDOG_MS,
  runWithWatchdog,
} from './cleanup-registry.ts';
import {
  assertSimulatorCanonicalBindings,
  assertSimulatorCanonicalInstance,
  assertSimulatorRendererModuleSource,
  type SimulatorCanonicalInstance,
  type SimulatorCanonicalRendererBindings,
  type SimulatorRendererModuleSource,
} from './renderer-contract.ts';
import type {
  SimulatorAdapterFactorySource,
  SimulatorAdapterPrepareContext,
  SimulatorHostPhase,
  SimulatorInstanceHost,
  SimulatorInstanceHostOptions,
  SimulatorPreparedSurfaceHost,
} from './instance-host-contract.ts';
import {
  assertSimulatorAdapterFactorySource,
  assertSimulatorAdapterInstance,
} from './instance-adapter-contract.ts';
import {
  enqueueWatchdogBoundLifecycleIntent,
  runSimulatorInstanceCleanup,
} from './instance-cleanup.ts';
import {
  completeInstanceFailedOpen,
  completeModuleFailedOpen,
  createLifecycleSettlementLedger,
  resetOwnsRecordDisposal,
  type SimulatorInstanceRecord,
} from './lifecycle-settlements.ts';
import { adapterCommandAdmissionError } from '../state-engine/caller-admission.ts';
import {
  assertSimulatorAdapterPortCurrent,
  simulatorAdapterPortError,
} from './adapter-port-state.ts';

export type {
  SimulatorCanonicalInstance,
  SimulatorCanonicalRendererBindings,
  SimulatorRendererModuleSource,
} from './renderer-contract.ts';
export type {
  SimulatorAdapterFactorySource,
  SimulatorAdapterInstance,
  SimulatorAdapterPrepareContext,
  SimulatorHostPhase,
  SimulatorInstanceHost,
  SimulatorInstanceHostOptions,
  SimulatorOpenInstanceInput,
  SimulatorPreparedSurfaceHost,
} from './instance-host-contract.ts';
type InstanceRecord = SimulatorInstanceRecord;
export function createSimulatorInstanceHost(options: SimulatorInstanceHostOptions): SimulatorInstanceHost {
  const { engine, timers } = options;
  const watchdogMs = options.watchdogMs ?? SIMULATOR_CLEANUP_WATCHDOG_MS;
  const instances = new Map<string, InstanceRecord>();
  const attachedBehaviors = new Map<string, SimulatorModuleBehavior>();
  const lifecycleSettlements = createLifecycleSettlementLedger(engine);
  function integrityFailure(error: SimulatorError): void {
    const wasTerminal = engine.phase === 'terminal';
    engine.terminateIntegrity(error);
    if (!wasTerminal) options.onSessionIntegrityFailure(error);
  }
  function issuerFor(record: InstanceRecord) {
    return { kind: 'instance' as const, moduleId: record.moduleId, instanceId: record.instanceId };
  }
  function runAdapter<T>(phase: 'instance-lifecycle' | 'callback', callback: () => T): T {
    return options.effectScope.run('app-adapter', phase, callback);
  }
  function runRenderer<T>(phase: 'instance-lifecycle' | 'callback', callback: () => T): T {
    return options.effectScope.run('canonical-renderer', phase, callback);
  }
  function buildPrepareContext(
    record: InstanceRecord,
    prepareWindow: SimulatorPrepareWindow,
  ): SimulatorAdapterPrepareContext {
    if (!record.surfaceHost) {
      throw new Error('SIMULATOR_SURFACE_HOST_MISSING');
    }
    const issuer = issuerFor(record);
    return {
      protocol: 'nimi.simulator.module/v1',
      moduleId: record.moduleId,
      instanceId: record.instanceId,
      surfaceId: record.surfaceId,
      epoch: record.epoch,
      abortSignal: record.abortController.signal,
      kit: record.surfaceHost.kit,
      commands: {
        invoke(type, payload) {
          const error = adapterCommandAdmissionError(
            type, record.moduleId, record.instanceId, simulatorAdapterPortError(engine, record),
          );
          if (error) return Promise.resolve(simulatorFail(error));
          return engine.acceptCommand(type, payload, issuer);
        },
      },
      events: {
        subscribe(eventType, handler) {
          const error = simulatorAdapterPortError(engine, record);
          if (error) return simulatorFail(error);
          return engine.subscribeEvent(
            prepareWindow,
            eventType,
            (payload, event) => {
              if (simulatorAdapterPortError(engine, record)) return;
              return runAdapter('callback', () => handler(payload, event));
            },
          );
        },
      },
      cleanup: {
        add(dispose) {
          return record.cleanup.registry.add(() => runAdapter('instance-lifecycle', dispose));
        },
        get phase() {
          return record.cleanup.registry.phase;
        },
        get registrationCount() {
          return record.cleanup.registry.registrationCount;
        },
      },
      projection: {
        get() {
          assertSimulatorAdapterPortCurrent(engine, record);
          const projected = engine.projectInstance(record.instanceId);
          if (!projected.ok) throw new Error(projected.error.code);
          return projected.value;
        },
        subscribe(listener) {
          assertSimulatorAdapterPortCurrent(engine, record);
          return engine.subscribeState(() => {
            if (simulatorAdapterPortError(engine, record)) return;
            try {
              const projected = runAdapter('callback', () => engine.projectInstance(record.instanceId));
              if (!projected.ok) throw new Error(projected.error.code);
              const returned = runAdapter('callback', () => listener(projected.value));
              if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
                throw new Error('async projection listener');
              }
            } catch {
              host.failInstance(record.instanceId, 'projection-listener-failure');
            }
          });
        },
      },
      route: {
        get() {
          assertSimulatorAdapterPortCurrent(engine, record);
          const instance = engine.getCommitted().instance(record.instanceId);
          if (!instance) throw new Error('SIMULATOR_INSTANCE_DISPOSED');
          return instance.route;
        },
        subscribe(listener) {
          assertSimulatorAdapterPortCurrent(engine, record);
          let previous = engine.getCommitted().instance(record.instanceId)?.route ?? null;
          return engine.subscribeState(() => {
            if (simulatorAdapterPortError(engine, record)) return;
            const next = engine.getCommitted().instance(record.instanceId)?.route ?? null;
            if (!next || next === previous) return;
            previous = next;
            try {
              const returned = runAdapter('callback', () => listener(next));
              if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
                throw new Error('async route listener');
              }
            } catch {
              host.failInstance(record.instanceId, 'route-listener-failure');
            }
          });
        },
        navigate(route) {
          const error = simulatorAdapterPortError(engine, record);
          if (error) return Promise.resolve(simulatorFail(error));
          return engine.acceptCommand('simulator.instance.route', {
            instanceId: record.instanceId,
            route: route as unknown as JsonValue,
          }, issuer);
        },
      },
      clock: {
        now() {
          assertSimulatorAdapterPortCurrent(engine, record);
          return engine.getCommitted().logicalTime;
        },
        schedule(command, delayMs) {
          const error = simulatorAdapterPortError(engine, record);
          if (error) return Promise.resolve(simulatorFail(error));
          return engine.acceptCommand('simulator.clock.schedule', {
            commandType: command.type,
            payload: command.payload,
            causationId: command.causationId,
            delayMs,
          }, issuer);
        },
        cancel(jobId) {
          const error = simulatorAdapterPortError(engine, record);
          if (error) return Promise.resolve(simulatorFail(error));
          return engine.acceptCommand('simulator.clock.cancelJob', { jobId }, issuer);
        },
      },
      asyncReservations: {
        reserve(input) {
          const error = simulatorAdapterPortError(engine, record);
          if (error) return simulatorFail(error);
          return engine.reserveAsync({
            issuer,
            causationId: null,
            commandType: input.commandType,
            outcomeSchemaId: input.outcomeSchemaId,
            onCommandSettlement: input.onCommandSettlement
              ? (result) => {
                  if (simulatorAdapterPortError(engine, record)) return;
                  runAdapter('callback', () => input.onCommandSettlement?.(result));
                }
              : null,
          });
        },
      },
    };
  }

  function enqueueIntent(record: InstanceRecord, intent: () => Promise<void>): void {
    record.intents = record.intents.then(intent, intent);
  }

  function enqueueWatchedIntent(record: InstanceRecord, intent: () => Promise<void>): Promise<boolean> {
    return enqueueWatchdogBoundLifecycleIntent({
      enqueue: (next) => enqueueIntent(record, next),
      intent,
      timers,
      watchdogMs,
    });
  }

  async function transition(record: InstanceRecord, name: string): Promise<SimulatorResult<JsonValue>> {
    return engine.acceptCommand('simulator.instance.transition', {
      instanceId: record.instanceId,
      transition: name,
    }, { kind: 'shell', moduleId: null, instanceId: null });
  }

  async function runOrderedCleanup(record: InstanceRecord): Promise<boolean> {
    return runSimulatorInstanceCleanup({
      record,
      timers,
      watchdogMs,
      runRenderer: (callback) => runRenderer('instance-lifecycle', callback),
      runAdapter: (callback) => runAdapter('instance-lifecycle', callback),
    });
  }

  async function finalizeDispose(record: InstanceRecord): Promise<void> {
    const cleaned = await runOrderedCleanup(record);
    if (!cleaned) {
      const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: record.moduleId,
        instanceId: record.instanceId,
      });
      record.disposeFailure = error;
      integrityFailure(error);
      record.resolveDisposeCompletion?.();
      return;
    }
    record.phase = 'disposed';
    const disposed = await engine.acceptCommand('simulator.instance.disposed', { instanceId: record.instanceId }, {
      kind: 'shell', moduleId: null, instanceId: null,
    });
    if (!disposed.ok) {
      const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: record.moduleId,
        instanceId: record.instanceId,
      });
      record.disposeFailure = error;
      integrityFailure(error);
      record.resolveDisposeCompletion?.();
      return;
    }
    options.onInstanceDisposed?.(record.instanceId);
    record.resolveDisposeCompletion?.();
  }

  function ensureDisposeCompletion(record: InstanceRecord): Promise<void> {
    if (!record.disposeCompletion) {
      record.disposeCompletion = new Promise<void>((resolve) => {
        record.resolveDisposeCompletion = resolve;
      });
    }
    return record.disposeCompletion;
  }

  async function beginDispose(record: InstanceRecord): Promise<void> {
    lifecycleSettlements.invalidateRecord(record, 'dispose');
    if (resetOwnsRecordDisposal(engine, record)) return;
    if (record.phase !== 'loading'
      && record.phase !== 'preparing'
      && record.phase !== 'ready'
      && record.phase !== 'failed') {
      return;
    }
    record.phase = 'disposing';
    const transitioning = await transition(record, 'dispose');
    if (!transitioning.ok) {
      const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: record.moduleId,
        instanceId: record.instanceId,
      });
      record.disposeFailure = error;
      integrityFailure(error);
      record.resolveDisposeCompletion?.();
      return;
    }
    await finalizeDispose(record);
  }

  function requestDispose(record: InstanceRecord): void {
    if (record.disposeStarted) return;
    record.disposeStarted = true;
    ensureDisposeCompletion(record);

    if (record.phase === 'loading') {
      // The in-flight immutable module import is not an instance resource and
      // cannot hold close open. Its late completion observes the invalid token
      // and constructs no Adapter.
      void beginDispose(record);
      return;
    }
    if (record.phase === 'preparing') {
      // The one admitted interrupt: invoke dispose once even if the prepare
      // Promise has not settled; the cleanup barrier observes that Promise.
      void beginDispose(record);
      return;
    }
    if (record.phase === 'ready' || record.phase === 'failed') {
      // Ordinary lifecycle intents are serialized. Close linearizes after any
      // already-started activate/deactivate callback, never through it.
      void enqueueWatchedIntent(record, () => beginDispose(record)).then((settled) => {
        if (settled || record.disposeFailure) return;
        const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
          moduleId: record.moduleId,
          instanceId: record.instanceId,
        });
        record.disposeFailure = error;
        integrityFailure(error);
        record.resolveDisposeCompletion?.();
      });
    }
  }

  const completeModuleOpenFailure = (record: InstanceRecord) => completeModuleFailedOpen({
    record,
    engine,
    transition: () => transition(record, 'attributable_failure'),
    onInstanceFailed: options.onInstanceFailed,
  });
  const completeInstanceOpenFailure = (record: InstanceRecord, cause: string) => completeInstanceFailedOpen({
    record,
    engine,
    cause,
    failInstance: (instanceId, failureCause) => host.failInstance(instanceId, failureCause),
  });

  const host: SimulatorInstanceHost = {
    openInstance(input) {
      const lifecycle = lifecycleSettlements.accept<{ readonly instanceId: string }>(
        'open',
        engine.epoch,
        input.moduleId,
        null,
      );
      const invalidatedOpen = (
        epoch: number,
      ): SimulatorResult<{ readonly instanceId: string }> => simulatorFail(lifecycleSettlements.error(
        lifecycle.terminal,
        engine.phase === 'terminal'
          ? 'SIMULATOR_INTEGRITY_FAILURE'
          : epoch !== engine.epoch ? 'SIMULATOR_STALE_EPOCH' : 'SIMULATOR_INSTANCE_DISPOSED',
      ));
      void (async (): Promise<SimulatorResult<{ readonly instanceId: string }>> => {
        const opened = await engine.acceptCommand('simulator.instance.open', {
        moduleId: input.moduleId,
        surfaceId: input.surfaceId,
        initialRoute: input.initialRoute as unknown as JsonValue,
      }, { kind: 'shell', moduleId: null, instanceId: null });
      if (!opened.ok) return simulatorFail(opened.error);
      const openedValue = opened.value as { readonly instanceId: string };
      const instanceId = openedValue.instanceId;
      lifecycle.terminal.instanceId = instanceId;
      if (engine.phase !== 'open' || engine.epoch !== lifecycle.terminal.epoch) {
        return invalidatedOpen(lifecycle.terminal.epoch);
      }

      let resolveInvalidated: () => void = () => undefined;
      const invalidated = new Promise<void>((resolve) => {
        resolveInvalidated = resolve;
      });
      const record: InstanceRecord = {
        instanceId,
        moduleId: input.moduleId,
        surfaceId: input.surfaceId,
        epoch: lifecycle.terminal.epoch,
        abortController: new AbortController(),
        invalidated,
        resolveInvalidated,
        phase: 'loading',
        tokenValid: true,
        adapter: null,
        canonical: null,
        surfaceHost: null,
        cleanup: createCleanupRegistry({
          instanceId,
        }),
        cleanupCompletion: null,
        pendingLoad: null,
        pendingPrepare: null,
        disposeStarted: false,
        disposeCompletion: null,
        resolveDisposeCompletion: null,
        adapterDisposed: false,
        canonicalDisposed: false,
        surfaceUnmounted: false,
        failureDiagnostic: null,
        disposeFailure: null,
        intents: Promise.resolve(),
      };
      instances.set(instanceId, record);

      const loadPromise = Promise.all([
        Promise.resolve().then(() => input.loadRenderer()),
        Promise.resolve().then(() => input.loadAdapter()),
        Promise.resolve().then(() => input.loadStyle()),
      ]);
      record.pendingLoad = loadPromise.then(() => undefined, () => undefined);
      const moduleResult = await Promise.race([
        loadPromise.then(
          ([rendererModule, adapterFactory]) => ({
            kind: 'loaded' as const,
            ok: true as const,
            rendererModule,
            adapterFactory,
          }),
          (error) => ({ kind: 'loaded' as const, ok: false as const, error }),
        ),
        record.invalidated.then(() => ({ kind: 'invalidated' as const })),
      ]);
      if (moduleResult.kind === 'invalidated' || !record.tokenValid || record.phase !== 'loading') {
        return invalidatedOpen(record.epoch);
      }
      if (!moduleResult.ok) {
        // Shared module-load fault: instances awaiting that graph fail.
        return completeModuleOpenFailure(record);
      }
      let rendererModule: SimulatorRendererModuleSource;
      let adapterFactory: SimulatorAdapterFactorySource;
      try {
        assertSimulatorRendererModuleSource(moduleResult.rendererModule, input.moduleId);
        assertSimulatorAdapterFactorySource(moduleResult.adapterFactory, input.moduleId);
        rendererModule = moduleResult.rendererModule;
        adapterFactory = moduleResult.adapterFactory;
      } catch {
        return completeModuleOpenFailure(record);
      }
      const attachedBehavior = attachedBehaviors.get(input.moduleId);
      if (attachedBehavior && attachedBehavior !== adapterFactory.behavior) {
        return completeModuleOpenFailure(record);
      }
      if (!attachedBehavior) {
        const attached = engine.attachModuleBehavior(input.moduleId, adapterFactory.behavior);
        if (!attached.ok) {
          return completeModuleOpenFailure(record);
        }
        attachedBehaviors.set(input.moduleId, adapterFactory.behavior);
      }
      const behaviorActivated = await engine.acceptCommand(
        'simulator.behavior.activate', { moduleId: input.moduleId }, { kind: 'shell', moduleId: null, instanceId: null },
      );
      if (!record.tokenValid || record.phase !== 'loading') {
        return invalidatedOpen(record.epoch);
      }
      if (!behaviorActivated.ok) {
        return completeModuleOpenFailure(record);
      }
      const loaded = await transition(record, 'module_loaded');
      if (!record.tokenValid || record.phase !== 'loading') {
        return invalidatedOpen(record.epoch);
      }
      if (!loaded.ok) {
        return simulatorFail(loaded.error);
      }
      record.phase = 'preparing';
      try {
        record.surfaceHost = options.prepareSurface({
          moduleId: record.moduleId,
          instanceId: record.instanceId,
          surfaceId: record.surfaceId,
        });
        record.adapter = runAdapter('instance-lifecycle', () => adapterFactory.create());
        assertSimulatorAdapterInstance(record.adapter);
      } catch {
        return completeInstanceOpenFailure(record, 'adapter-construction-failure');
      }
      record.cleanup.beginWindow();
      const prepareWindowResult = engine.beginPrepareWindow(instanceId);
      if (!prepareWindowResult.ok) {
        record.cleanup.closeWindow();
        return completeInstanceOpenFailure(record, 'prepare-window-failure');
      }
      const prepareWindow = prepareWindowResult.value;
      let prepareOutcome:
        | { ok: true; value: SimulatorCanonicalRendererBindings }
        | { ok: false; error: unknown };
      try {
        const prepared = runAdapter(
          'instance-lifecycle',
          () => record.adapter?.prepare(buildPrepareContext(record, prepareWindow)) as
            | Promise<SimulatorCanonicalRendererBindings>
            | SimulatorCanonicalRendererBindings,
        );
        record.cleanup.closeWindow();
        prepareWindow.close();
        if (prepared && typeof (prepared as Promise<SimulatorCanonicalRendererBindings>).then === 'function') {
          record.pendingPrepare = prepared as Promise<SimulatorCanonicalRendererBindings>;
          prepareOutcome = await Promise.race([
            record.pendingPrepare.then(
              (value) => ({ ok: true as const, value }),
              (error) => ({ ok: false as const, error }),
            ),
            record.invalidated.then(() => ({
              ok: false as const,
              error: new Error('SIMULATOR_PREPARE_INVALIDATED'),
            })),
          ]);
        } else {
          prepareOutcome = {
            ok: true,
            value: prepared as SimulatorCanonicalRendererBindings,
          };
        }
      } catch (error) {
        record.cleanup.closeWindow();
        prepareWindow.close();
        prepareOutcome = { ok: false, error };
      }
      // Stale completion: a close interrupted the pending prepare.
      if (!record.tokenValid || record.phase !== 'preparing') {
        return invalidatedOpen(record.epoch);
      }
      if (!prepareOutcome.ok) {
        return completeInstanceOpenFailure(record, 'prepare-failure');
      }
      try {
        assertSimulatorCanonicalBindings(prepareOutcome.value);
        record.canonical = runRenderer(
          'instance-lifecycle',
          () => rendererModule.factory.createInstance(prepareOutcome.value),
        );
        assertSimulatorCanonicalInstance(record.canonical, input.surfaceId);
      } catch {
        return completeInstanceOpenFailure(record, 'factory-failure');
      }
      const prepared = await transition(record, 'prepare_success');
      if (!record.tokenValid || record.phase !== 'preparing') {
        return invalidatedOpen(record.epoch);
      }
      if (!prepared.ok) return simulatorFail(prepared.error);
      record.phase = 'ready';
      if (input.activateBeforeMount) {
        const activated = await transition(record, 'activate');
        if (!activated.ok) return completeInstanceOpenFailure(record, 'activate-transition-failure');
        try {
          record.cleanup.beginWindow();
          await runAdapter('instance-lifecycle', () => record.adapter?.activate?.());
          record.cleanup.closeWindow();
        } catch {
          record.cleanup.closeWindow();
          return completeInstanceOpenFailure(record, 'activate-failure');
        }
      }
      try {
        // The surface cannot report readiness until the authoritative initial
        // inactive/active lifecycle intent has committed.
        record.surfaceHost.mount(record.canonical);
      } catch {
        return completeInstanceOpenFailure(record, 'surface-mount-failure');
      }
      return simulatorOk({ instanceId });
      })().then(
        (result) => lifecycle.settle(result),
        () => lifecycle.settle(simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
          moduleId: input.moduleId,
          instanceId: lifecycle.terminal.instanceId,
        }))),
      );
      return lifecycle.promise;
    },

    activateInstance(instanceId) {
      const record = instances.get(instanceId);
      if (!record) {
        return Promise.resolve(simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { instanceId })));
      }
      const lifecycle = lifecycleSettlements.accept<{ readonly activated: boolean }>(
        'activate',
        record.epoch,
        record.moduleId,
        record.instanceId,
      );
      enqueueIntent(record, async () => {
        if (record.phase !== 'ready') {
          lifecycle.settle(simulatorOk({ activated: false }));
          return;
        }
        const transitionResult = await transition(record, 'activate');
        if (!transitionResult.ok) {
          lifecycle.settle(simulatorFail(transitionResult.error));
          return;
        }
        try {
          record.cleanup.beginWindow();
          const activated = runAdapter('instance-lifecycle', () => record.adapter?.activate?.());
          record.cleanup.closeWindow();
          await activated;
          lifecycle.settle(record.tokenValid && record.phase === 'ready'
            ? simulatorOk({ activated: true })
            : simulatorFail(simulatorError('SIMULATOR_INSTANCE_FAILED', { instanceId })));
        } catch {
          record.cleanup.closeWindow();
          host.failInstance(instanceId, 'activate-failure');
          lifecycle.settle(simulatorFail(simulatorError('SIMULATOR_INSTANCE_FAILED', { instanceId })));
        }
      });
      return lifecycle.promise;
    },

    deactivateInstance(instanceId) {
      const record = instances.get(instanceId);
      if (!record) {
        return Promise.resolve(simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { instanceId })));
      }
      const lifecycle = lifecycleSettlements.accept<{ readonly deactivated: boolean }>(
        'deactivate',
        record.epoch,
        record.moduleId,
        record.instanceId,
      );
      enqueueIntent(record, async () => {
        if (record.phase !== 'ready') {
          lifecycle.settle(simulatorOk({ deactivated: false }));
          return;
        }
        const transitionResult = await transition(record, 'deactivate');
        if (!transitionResult.ok) {
          lifecycle.settle(simulatorFail(transitionResult.error));
          return;
        }
        try {
          await runAdapter('instance-lifecycle', () => record.adapter?.deactivate?.());
          lifecycle.settle(record.tokenValid && record.phase === 'ready'
            ? simulatorOk({ deactivated: true })
            : simulatorFail(simulatorError('SIMULATOR_INSTANCE_FAILED', { instanceId })));
        } catch {
          host.failInstance(instanceId, 'deactivate-failure');
          lifecycle.settle(simulatorFail(simulatorError('SIMULATOR_INSTANCE_FAILED', { instanceId })));
        }
      });
      return lifecycle.promise;
    },

    disposeInstance(instanceId) {
      const record = instances.get(instanceId);
      if (!record) {
        return Promise.resolve(simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { instanceId })));
      }
      if (record.phase === 'disposed') {
        return Promise.resolve(simulatorOk({ disposed: false }));
      }
      const lifecycle = lifecycleSettlements.accept<{ readonly disposed: boolean }>(
        'dispose', record.epoch, record.moduleId, record.instanceId,
      );
      requestDispose(record);
      void ensureDisposeCompletion(record).then(() => lifecycle.settle(
        record.disposeFailure ? simulatorFail(record.disposeFailure) : simulatorOk({ disposed: true }),
      ));
      return lifecycle.promise;
    },

    failInstance(instanceId, cause) {
      const record = instances.get(instanceId);
      if (!record || record.phase === 'disposed' || record.phase === 'disposing' || record.phase === 'failed') {
        return;
      }
      lifecycleSettlements.invalidateRecord(record, 'failure');
      record.phase = 'failed';
      record.failureDiagnostic = simulatorError('SIMULATOR_INSTANCE_FAILED', {
        moduleId: record.moduleId,
        instanceId,
      });
      void enqueueWatchedIntent(record, async () => {
        if (record.phase === 'disposed' || record.phase === 'disposing') return;
        const cleaned = await runOrderedCleanup(record);
        if (!cleaned) {
          integrityFailure(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
            moduleId: record.moduleId,
            instanceId,
          }));
          return;
        }
        await transition(record, 'attributable_failure');
        options.onInstanceFailed?.(instanceId, simulatorError('SIMULATOR_INSTANCE_FAILED', {
          moduleId: record.moduleId,
          instanceId,
        }));
        void cause;
      }).then((settled) => {
        if (!settled) {
          integrityFailure(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
            moduleId: record.moduleId,
            instanceId,
          }));
        }
      });
    },

    invalidateEpoch(oldEpoch) {
      const resetting = engine.phase === 'resetting';
      if (resetting) lifecycleSettlements.queueReset(oldEpoch);
      else lifecycleSettlements.settleSession();
      for (const record of instances.values()) {
        lifecycleSettlements.invalidateRecord(record, resetting ? 'reset' : 'session');
      }
    },

    async disposeAllForReset(instancesToDispose) {
      for (const instanceRef of instancesToDispose) {
        const record = instances.get(instanceRef.instanceId);
        if (!record) continue;
        lifecycleSettlements.invalidateRecord(record, 'reset');
        if (record.phase !== 'disposed') {
          const settled = await enqueueWatchedIntent(record, async () => {
            const cleaned = await runOrderedCleanup(record);
            if (!cleaned) throw new Error('reset cleanup failed');
            record.phase = 'disposed';
            options.onInstanceDisposed?.(record.instanceId);
          });
          if (!settled) {
            throw new Error('reset cleanup failed');
          }
        }
        record.resolveDisposeCompletion?.();
      }
    },

    collectResetTerminalSettlements(record) {
      lifecycleSettlements.collectReset(record);
    },

    phaseOf(instanceId) {
      return instances.get(instanceId)?.phase ?? null;
    },

    hasLiveResources(instanceId) {
      const record = instances.get(instanceId);
      if (!record) return false;
      return (
        (record.adapter !== null && !record.adapterDisposed)
        || (record.canonical !== null && !record.canonicalDisposed)
        || (record.surfaceHost !== null && !record.surfaceUnmounted)
        || (record.cleanup.registry.registrationCount > 0 && !record.cleanup.ran)
      );
    },
  };

  return host;
}
