import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { simulatorError } from '../../src/state-engine/errors.ts';
import { createSimulatorInstanceHost } from '../../src/lifecycle/instance-host.ts';
import { createCleanupRegistry } from '../../src/lifecycle/cleanup-registry.ts';
import { runSimulatorInstanceCleanup } from '../../src/lifecycle/instance-cleanup.ts';
import {
  fixtureCanonicalBindings,
  fixtureModule,
  fixtureModuleCatalog,
  fixtureScenario,
  SCENARIO_ISSUER,
  SHELL_ISSUER,
} from './fixtures.mjs';

function fakeTimers() {
  const pending = new Map();
  let counter = 0;
  let now = 0;
  return {
    timers: {
      setTimeout(handler, delayMs) {
        counter += 1;
        pending.set(counter, { handler, at: now + delayMs });
        return counter;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
      now: () => now,
    },
    advance(ms) {
      now += ms;
      for (const [handle, entry] of [...pending.entries()]) {
        if (entry.at <= now) {
          pending.delete(handle);
          entry.handler();
        }
      }
    },
    pendingCount: () => pending.size,
  };
}

function makeAdapter(behavior = {}) {
  const calls = { prepare: 0, activate: 0, deactivate: 0, dispose: 0 };
  const adapter = {
    calls,
    prepare: behavior.prepare ?? (() => { calls.prepare += 1; return fixtureCanonicalBindings(); }),
    activate: behavior.activate ?? (() => { calls.activate += 1; }),
    deactivate: behavior.deactivate ?? (() => { calls.deactivate += 1; }),
    dispose: behavior.dispose ?? (() => { calls.dispose += 1; }),
  };
  return adapter;
}

function makeModule(moduleId, adapter, options = {}) {
  return {
    rendererModule: {
      protocol: 'nimi.simulator.module/v1',
      moduleId,
      factory: {
        factoryId: `${moduleId}-factory`,
        createInstance: options.createInstance ?? (() => ({
          surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
          dispose: () => { options.canonicalDisposals ? options.canonicalDisposals.count += 1 : undefined; },
        })),
      },
    },
    adapterFactory: {
      protocol: 'nimi.simulator.module/v1',
      moduleId,
      behavior: options.moduleBehavior ?? fixtureModule(moduleId).behavior,
      create: () => adapter,
    },
  };
}

function createHarness({ hooks = {}, timers, effectScope, prepareSurface } = {}) {
  const hostRef = { current: null };
  const engine = createSimulatorStateEngine({
    scenario: fixtureScenario(),
    hooks: {
      requestInstanceFailure: (instanceId, cause) => hostRef.current?.failInstance(instanceId, cause),
      invalidateEpoch: (oldEpoch) => hostRef.current?.invalidateEpoch(oldEpoch),
      disposeInstancesForReset: (instances) => hostRef.current?.disposeAllForReset(instances) ?? Promise.resolve(),
      collectResetTerminalSettlements: (record) => {
        hostRef.current?.collectResetTerminalSettlements((sequence, settle) => {
          record('lifecycle', sequence, settle);
        });
      },
      ...hooks,
    },
  });
  engine.registerModuleCatalog(fixtureModuleCatalog(fixtureModule()));
  const integrity = [];
  const failed = [];
  const disposed = [];
  const clock = timers ?? fakeTimers();
  const host = createSimulatorInstanceHost({
    engine,
    timers: clock.timers,
    effectScope: effectScope ?? { run: (_owner, _phase, callback) => callback() },
    prepareSurface: prepareSurface ?? (() => ({
      kit: fixtureCanonicalBindings().kit,
      mount: () => {},
      unmount: () => {},
    })),
    onSessionIntegrityFailure: (error) => integrity.push(error.code),
    onInstanceFailed: (instanceId, error) => failed.push([instanceId, error.code]),
    onInstanceDisposed: (instanceId) => disposed.push(instanceId),
  });
  hostRef.current = host;
  return { engine, host, integrity, failed, disposed, clock };
}

async function openReady(harness, { moduleId = 'fixture-module', adapter = makeAdapter() } = {}) {
  const moduleSource = makeModule(moduleId, adapter);
  const opened = await harness.host.openInstance({
    moduleId,
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => moduleSource.rendererModule,
    loadAdapter: async () => moduleSource.adapterFactory,
    loadStyle: async () => undefined,
  });
  assert.equal(opened.ok, true);
  return opened.value.instanceId;
}

test('full lifecycle: open, activate, deactivate, dispose with exact transition order', async () => {
  const harness = createHarness();
  const adapter = makeAdapter();
  const instanceId = await openReady(harness, { adapter });
  assert.equal(harness.host.phaseOf(instanceId), 'ready');
  assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'inactive');

  const activated = await harness.host.activateInstance(instanceId);
  assert.deepEqual(activated, { ok: true, value: { activated: true } });
  assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'active');

  const deactivated = await harness.host.deactivateInstance(instanceId);
  assert.deepEqual(deactivated.value, { deactivated: true });

  const disposedResult = await harness.host.disposeInstance(instanceId);
  assert.deepEqual(disposedResult.value, { disposed: true });
  assert.equal(harness.host.phaseOf(instanceId), 'disposed');
  assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'disposed');
  assert.equal(adapter.calls.dispose, 1);
  assert.deepEqual(harness.integrity, []);
});

test('close during loading constructs no Adapter and runs no Adapter disposal', async () => {
  const harness = createHarness();
  const adapter = makeAdapter();
  let resolveImport;
  const importPromise = new Promise((resolve) => { resolveImport = resolve; });
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: () => importPromise.then((source) => source.rendererModule),
    loadAdapter: () => importPromise.then((source) => source.adapterFactory),
    loadStyle: () => importPromise.then(() => undefined),
  });
  // Let the open operation commit and the lazy import begin.
  await new Promise((resolve) => setImmediate(resolve));
  const instanceId = '1:instance:1';
  assert.equal(harness.host.phaseOf(instanceId), 'loading');
  const disposePromise = harness.host.disposeInstance(instanceId);
  let disposeSettled = false;
  void disposePromise.then(() => { disposeSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposeSettled, true, 'an immutable module import cannot hold instance close open');
  // The late import completes into the immutable cache only.
  resolveImport(makeModule('fixture-module', adapter));
  await disposePromise;
  await opening;
  assert.equal(harness.host.phaseOf(instanceId), 'disposed');
  assert.equal(adapter.calls.prepare, 0);
  assert.equal(adapter.calls.dispose, 0);
  assert.deepEqual(harness.integrity, []);
  const lateDefinition = fixtureModule();
  const lateAttach = harness.engine.attachModuleBehavior(
    lateDefinition.moduleId,
    lateDefinition.behavior,
  );
  assert.equal(lateAttach.ok, true, 'a closed loading instance must not attach App behavior');
});

test('a late module-load rejection cannot resurrect a disposed host record', async () => {
  const harness = createHarness();
  let rejectImport;
  const importPromise = new Promise((_, reject) => { rejectImport = reject; });
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: () => importPromise,
    loadAdapter: () => importPromise,
    loadStyle: () => importPromise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const disposed = await harness.host.disposeInstance('1:instance:1');
  const openResult = await opening;
  assert.equal(disposed.ok, true);
  assert.equal(openResult.ok, false);
  assert.equal(openResult.error.code, 'SIMULATOR_INSTANCE_DISPOSED');

  rejectImport(new Error('late immutable import failure'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.host.phaseOf('1:instance:1'), 'disposed');
  assert.equal(harness.engine.getCommitted().instance('1:instance:1').status, 'disposed');
  assert.deepEqual(harness.failed, []);
});

test('open and reset share the captured epoch and cannot create a new-epoch orphan record', async () => {
  const harness = createHarness();
  const adapter = makeAdapter();
  const source = makeModule('fixture-module', adapter);
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => source.rendererModule,
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  const resetting = harness.engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  const [openResult, resetResult] = await Promise.all([opening, resetting]);

  assert.equal(resetResult.ok, true);
  assert.equal(openResult.ok, false);
  assert.equal(openResult.error.code, 'SIMULATOR_STALE_EPOCH');
  assert.equal(harness.host.phaseOf('1:instance:1'), null);
  assert.equal(harness.engine.getCommitted().instance('1:instance:1'), null);
  assert.equal(adapter.calls.prepare, 0);
});

test('close serializes after an in-flight activate callback', async () => {
  const harness = createHarness();
  const order = [];
  let releaseActivate;
  const adapter = makeAdapter({
    activate: async () => {
      order.push('activate:start');
      await new Promise((resolve) => { releaseActivate = resolve; });
      order.push('activate:end');
    },
    dispose: () => { order.push('adapter:dispose'); },
  });
  const instanceId = await openReady(harness, { adapter });
  const activating = harness.host.activateInstance(instanceId);
  await new Promise((resolve) => setImmediate(resolve));
  const disposing = harness.host.disposeInstance(instanceId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['activate:start']);
  assert.equal(harness.host.phaseOf(instanceId), 'ready');

  releaseActivate();
  const activated = await activating;
  assert.deepEqual(activated, { ok: true, value: { activated: true } });
  const disposed = await disposing;
  assert.equal(disposed.ok, true);
  assert.deepEqual(order, ['activate:start', 'activate:end', 'adapter:dispose']);
  assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'disposed');
});

test('failure and close serialize cleanup after in-flight lifecycle callbacks', async (context) => {
  for (const operation of ['activate', 'deactivate']) {
    await context.test(operation, async () => {
      const order = [];
      let release;
      const harness = createHarness({
        prepareSurface: () => ({
          kit: fixtureCanonicalBindings().kit,
          mount: () => {},
          unmount: () => { order.push('surface:unmount'); },
        }),
      });
      const adapter = makeAdapter({
        prepare: (prepareContext) => {
          prepareContext.cleanup.add(() => { order.push('host:cleanup:a'); });
          prepareContext.cleanup.add(() => { order.push('host:cleanup:b'); });
          return fixtureCanonicalBindings();
        },
        activate: operation === 'activate'
          ? async () => {
              order.push('activate:start');
              await new Promise((resolve) => { release = resolve; });
              order.push('activate:end');
            }
          : undefined,
        deactivate: operation === 'deactivate'
          ? async () => {
              order.push('deactivate:start');
              await new Promise((resolve) => { release = resolve; });
              order.push('deactivate:end');
            }
          : undefined,
        dispose: () => { order.push('adapter:dispose'); },
      });
      const canonicalDisposals = { count: 0 };
      const source = makeModule('fixture-module', adapter, {
        canonicalDisposals,
        createInstance: () => ({
          surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
          dispose: () => {
            canonicalDisposals.count += 1;
            order.push('canonical:dispose');
          },
        }),
      });
      const opened = await harness.host.openInstance({
        moduleId: 'fixture-module',
        surfaceId: 'main',
        initialRoute: { pathname: '/', search: [], fragment: null },
        loadRenderer: async () => source.rendererModule,
        loadAdapter: async () => source.adapterFactory,
        loadStyle: async () => undefined,
      });
      const instanceId = opened.value.instanceId;
      if (operation === 'deactivate') await harness.host.activateInstance(instanceId);
      const lifecycle = operation === 'activate'
        ? harness.host.activateInstance(instanceId)
        : harness.host.deactivateInstance(instanceId);
      await new Promise((resolve) => setImmediate(resolve));
      harness.host.failInstance(instanceId, `${operation}-external-failure`);
      const disposing = harness.host.disposeInstance(instanceId);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(order, [`${operation}:start`]);

      release();
      const lifecycleResult = await lifecycle;
      assert.equal(lifecycleResult.ok, false);
      const disposed = await disposing;
      assert.equal(disposed.ok, true);
      assert.deepEqual(order, [
        `${operation}:start`,
        `${operation}:end`,
        'surface:unmount',
        'canonical:dispose',
        'adapter:dispose',
        'host:cleanup:b',
        'host:cleanup:a',
      ]);
      assert.equal(canonicalDisposals.count, 1);
      assert.equal(adapter.calls.dispose, 0, 'custom dispose path must run exactly through the order log');
      assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'disposed');
      assert.deepEqual(harness.integrity, []);
    });
  }
});

test('a never-settling ordinary lifecycle intent reaches terminal without concurrent cleanup', async () => {
  const clock = fakeTimers();
  const order = [];
  const harness = createHarness({
    timers: clock,
    prepareSurface: () => ({
      kit: fixtureCanonicalBindings().kit,
      mount: () => {},
      unmount: () => { order.push('surface:unmount'); },
    }),
  });
  const adapter = makeAdapter({
    activate: async () => {
      order.push('activate:start');
      await new Promise(() => {});
    },
    dispose: () => { order.push('adapter:dispose'); },
  });
  const instanceId = await openReady(harness, { adapter });
  const activating = harness.host.activateInstance(instanceId);
  await new Promise((resolve) => setImmediate(resolve));
  const disposing = harness.host.disposeInstance(instanceId);
  clock.advance(5001);
  const disposed = await disposing;
  const activated = await activating;
  assert.equal(disposed.ok, false);
  assert.equal(disposed.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(activated.ok, false);
  assert.equal(activated.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.deepEqual(order, ['activate:start']);
  assert.equal(harness.engine.phase, 'terminal');
  assert.deepEqual(harness.integrity, ['SIMULATOR_INTEGRITY_FAILURE']);
});

test('scenario reset waits for an in-flight lifecycle intent before cleanup', async () => {
  const order = [];
  let releaseActivate;
  const harness = createHarness({
    prepareSurface: () => ({
      kit: fixtureCanonicalBindings().kit,
      mount: () => {},
      unmount: () => { order.push('surface:unmount'); },
    }),
  });
  const adapter = makeAdapter({
    activate: async () => {
      order.push('activate:start');
      await new Promise((resolve) => { releaseActivate = resolve; });
      order.push('activate:end');
    },
    dispose: () => { order.push('adapter:dispose'); },
  });
  const source = makeModule('fixture-module', adapter, {
    createInstance: () => ({
      surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
      dispose: () => { order.push('canonical:dispose'); },
    }),
  });
  const opened = await harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => source.rendererModule,
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  const settlementOrder = [];
  const activating = harness.host.activateInstance(opened.value.instanceId).then((result) => {
    settlementOrder.push('lifecycle');
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const resetting = harness.engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER).then((result) => {
    settlementOrder.push('reset');
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['activate:start']);

  releaseActivate();
  const reset = await resetting;
  const activated = await activating;
  assert.equal(activated.ok, false);
  assert.equal(reset.ok, true);
  assert.deepEqual(settlementOrder, ['reset', 'lifecycle']);
  assert.deepEqual(order, [
    'activate:start',
    'activate:end',
    'surface:unmount',
    'canonical:dispose',
    'adapter:dispose',
  ]);
  assert.equal(harness.engine.phase, 'open');
  assert.deepEqual(harness.integrity, []);
});

test('reset terminally settles an open whose immutable imports never settle after the reset result', async () => {
  const harness = createHarness();
  const never = new Promise(() => {});
  const settlementOrder = [];
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: () => never,
    loadAdapter: () => never,
    loadStyle: () => never,
  }).then((result) => {
    settlementOrder.push('lifecycle');
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const resetting = harness.engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER).then((result) => {
    settlementOrder.push('reset');
    return result;
  });

  const reset = await resetting;
  const opened = await opening;
  assert.equal(reset.ok, true);
  assert.equal(opened.ok, false);
  assert.equal(opened.error.code, 'SIMULATOR_STALE_EPOCH');
  assert.deepEqual(settlementOrder, ['reset', 'lifecycle']);
  assert.equal(harness.host.phaseOf('1:instance:1'), 'disposed');
  assert.equal(harness.engine.getCommitted().instance('1:instance:1'), null);
});

test('session terminally settles a deactivate callback that never settles', async () => {
  const harness = createHarness();
  const adapter = makeAdapter({
    deactivate: () => new Promise(() => {}),
  });
  const instanceId = await openReady(harness, { adapter });
  await harness.host.activateInstance(instanceId);
  const deactivating = harness.host.deactivateInstance(instanceId);
  await new Promise((resolve) => setImmediate(resolve));
  harness.engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { instanceId }));

  const result = await deactivating;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(harness.engine.phase, 'terminal');
});

test('two instances share one lazy behavior attachment but construct isolated Adapters', async () => {
  const harness = createHarness();
  const firstAdapter = makeAdapter();
  const secondAdapter = makeAdapter();
  const behavior = fixtureModule().behavior;
  const firstSource = makeModule('fixture-module', firstAdapter, { moduleBehavior: behavior });
  const secondSource = makeModule('fixture-module', secondAdapter, { moduleBehavior: behavior });

  const [first, second] = await Promise.all([
    harness.host.openInstance({
      moduleId: 'fixture-module',
      surfaceId: 'main',
      initialRoute: { pathname: '/', search: [], fragment: null },
      loadRenderer: async () => firstSource.rendererModule,
      loadAdapter: async () => firstSource.adapterFactory,
      loadStyle: async () => undefined,
    }),
    harness.host.openInstance({
      moduleId: 'fixture-module',
      surfaceId: 'main',
      initialRoute: { pathname: '/second', search: [], fragment: null },
      loadRenderer: async () => secondSource.rendererModule,
      loadAdapter: async () => secondSource.adapterFactory,
      loadStyle: async () => undefined,
    }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(harness.host.phaseOf(first.value.instanceId), 'ready');
  assert.equal(harness.host.phaseOf(second.value.instanceId), 'ready');
  assert.notEqual(first.value.instanceId, second.value.instanceId);
  assert.equal(firstAdapter.calls.prepare, 1);
  assert.equal(secondAdapter.calls.prepare, 1);
  assert.equal(harness.engine.phase, 'open');
});

test('an interrupted prepare that never settles trips the one cleanup watchdog', async () => {
  const clock = fakeTimers();
  const harness = createHarness({ timers: clock });
  const disposeCalls = { count: 0 };
  const adapter = makeAdapter({
    prepare: () => new Promise(() => {}),
    dispose: () => { disposeCalls.count += 1; },
  });
  const source = makeModule('fixture-module', adapter);
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => source.rendererModule,
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  for (let index = 0; index < 10 && harness.host.phaseOf('1:instance:1') !== 'preparing'; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const disposing = harness.host.disposeInstance('1:instance:1');
  await opening;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposeCalls.count, 1);
  clock.advance(5001);
  const disposed = await disposing;
  assert.equal(disposed.ok, false);
  assert.equal(disposed.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.deepEqual(harness.integrity, ['SIMULATOR_INTEGRITY_FAILURE']);
});

test('close during prepare aborts, disposes once, and treats late settlement as stale', async () => {
  const harness = createHarness();
  let resolvePrepare;
  const preparePromise = new Promise((resolve) => { resolvePrepare = resolve; });
  const adapter = makeAdapter({
    prepare: () => preparePromise,
    dispose: () => { /* counted via calls below */ },
  });
  const disposeCalls = { count: 0 };
  adapter.dispose = () => { disposeCalls.count += 1; };
  const opening = harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => makeModule('fixture-module', adapter).rendererModule,
    loadAdapter: async () => makeModule('fixture-module', adapter).adapterFactory,
    loadStyle: async () => undefined,
  });
  // Wait until the instance is preparing.
  for (let index = 0; index < 10 && harness.host.phaseOf('1:instance:1') !== 'preparing'; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(harness.host.phaseOf('1:instance:1'), 'preparing');
  const disposePromise = harness.host.disposeInstance('1:instance:1');
  // Settle the pending prepare after the interrupt: its completion is stale.
  resolvePrepare(fixtureCanonicalBindings());
  await disposePromise;
  await opening;
  assert.equal(harness.host.phaseOf('1:instance:1'), 'disposed');
  assert.equal(disposeCalls.count, 1);
  assert.equal(harness.engine.getCommitted().instance('1:instance:1').status, 'disposed');
  assert.deepEqual(harness.integrity, []);
});

test('repeated dispose changes no counter after first completion', async () => {
  const harness = createHarness();
  const adapter = makeAdapter();
  const instanceId = await openReady(harness, { adapter });
  await harness.host.disposeInstance(instanceId);
  const revision = harness.engine.getCommitted().revision;
  const first = await harness.host.disposeInstance(instanceId);
  assert.deepEqual(first.value, { disposed: false });
  const second = await harness.host.disposeInstance(instanceId);
  assert.deepEqual(second.value, { disposed: false });
  assert.equal(adapter.calls.dispose, 1);
  assert.equal(harness.engine.getCommitted().revision, revision);
  assert.deepEqual(harness.integrity, []);
});

test('host cleanup runs once in reverse registration order', async () => {
  const harness = createHarness();
  const order = [];
  const adapter = makeAdapter({
    prepare: (context) => {
      context.cleanup.add(() => { order.push('a'); });
      context.cleanup.add(() => { order.push('b'); });
      context.cleanup.add(() => { order.push('c'); });
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  await harness.host.disposeInstance(instanceId);
  assert.deepEqual(order, ['c', 'b', 'a']);
  assert.equal(harness.host.hasLiveResources(instanceId), false);
});

test('concurrent cleanup callers join one exact ordered barrier', async () => {
  const clock = fakeTimers();
  const order = [];
  let releaseUnmount;
  const cleanup = createCleanupRegistry({ instanceId: '1:instance:1' });
  cleanup.beginWindow();
  cleanup.registry.add(() => { order.push('host:a'); });
  cleanup.registry.add(() => { order.push('host:b'); });
  cleanup.closeWindow();
  const record = {
    cleanup,
    cleanupCompletion: null,
    pendingPrepare: null,
    surfaceHost: {
      kit: fixtureCanonicalBindings().kit,
      mount() {},
      async unmount() {
        order.push('surface:start');
        await new Promise((resolve) => { releaseUnmount = resolve; });
        order.push('surface:end');
      },
    },
    canonical: { surfaces: {}, dispose: () => { order.push('canonical'); } },
    adapter: { dispose: () => { order.push('adapter'); } },
    surfaceUnmounted: false,
    canonicalDisposed: false,
    adapterDisposed: false,
  };
  const options = {
    record,
    timers: clock.timers,
    watchdogMs: 5000,
    runRenderer: (callback) => callback(),
    runAdapter: (callback) => callback(),
  };
  const first = runSimulatorInstanceCleanup(options);
  const second = runSimulatorInstanceCleanup(options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['surface:start']);
  releaseUnmount();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(order, [
    'surface:start',
    'surface:end',
    'canonical',
    'adapter',
    'host:b',
    'host:a',
  ]);
});

test('cleanup rejection still attempts every remaining callback in reverse order', async () => {
  const harness = createHarness();
  const order = [];
  const adapter = makeAdapter({
    prepare: (context) => {
      context.cleanup.add(() => { order.push('a'); });
      context.cleanup.add(() => { order.push('b'); });
      context.cleanup.add(() => {
        order.push('c');
        throw new Error('c failed');
      });
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  const disposed = await harness.host.disposeInstance(instanceId);
  assert.equal(disposed.ok, false);
  assert.deepEqual(order, ['c', 'b', 'a']);
  assert.deepEqual(harness.integrity, ['SIMULATOR_INTEGRITY_FAILURE']);
});

test('module metadata cannot substitute the renderer-host binding protocol', async () => {
  const harness = createHarness();
  const adapter = makeAdapter();
  const source = makeModule('fixture-module', adapter);
  const opened = await harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => ({
      ...source.rendererModule,
      protocol: 'nimi.renderer.host/v1',
    }),
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.error.code, 'SIMULATOR_MODULE_FAILED');
  const instanceId = opened.error.instanceId;
  assert.equal(harness.host.phaseOf(instanceId), 'failed');
  assert.equal(adapter.calls.prepare, 0);
  assert.deepEqual(harness.failed, [[instanceId, 'SIMULATOR_MODULE_FAILED']]);
});

test('canonical bindings reject extension fields before the App factory runs', async () => {
  const harness = createHarness();
  let factoryCalls = 0;
  const adapter = makeAdapter({
    prepare: () => ({ ...fixtureCanonicalBindings(), hostKind: 'simulator' }),
  });
  const source = makeModule('fixture-module', adapter, {
    createInstance: () => {
      factoryCalls += 1;
      return {
        surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
        dispose() {},
      };
    },
  });
  const opened = await harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => source.rendererModule,
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.ok, false);
  assert.equal(opened.error.code, 'SIMULATOR_INSTANCE_FAILED');
  const instanceId = opened.error.instanceId;
  assert.equal(harness.host.phaseOf(instanceId), 'failed');
  assert.equal(factoryCalls, 0);
  assert.deepEqual(harness.failed, [[instanceId, 'SIMULATOR_INSTANCE_FAILED']]);
});

test('actual Adapter and canonical lifecycle callbacks enter the governed owner/phase scope', async () => {
  const scopes = [];
  const harness = createHarness({
    effectScope: {
      run(owner, phase, callback) {
        scopes.push(`${owner}:${phase}`);
        return callback();
      },
    },
  });
  const adapter = makeAdapter({
    prepare(context) {
      context.cleanup.add(() => {});
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  await harness.host.activateInstance(instanceId);
  await harness.host.deactivateInstance(instanceId);
  await harness.host.disposeInstance(instanceId);
  assert.ok(scopes.includes('app-adapter:instance-lifecycle'));
  assert.ok(scopes.includes('canonical-renderer:instance-lifecycle'));
  assert.ok(scopes.filter((entry) => entry === 'app-adapter:instance-lifecycle').length >= 5);
});

test('cleanup registration outside the synchronous prefix fails conformance', async () => {
  const harness = createHarness();
  let captured;
  const adapter = makeAdapter({
    prepare: (context) => {
      captured = context;
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  const late = captured.cleanup.add(() => {});
  assert.equal(late.ok, false);
  assert.equal(late.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  await harness.host.disposeInstance(instanceId);
});

test('captured Adapter ports fail closed after dispose and reset', async () => {
  const harness = createHarness();
  let firstContext;
  const firstAdapter = makeAdapter({
    prepare(context) {
      firstContext = context;
      return fixtureCanonicalBindings();
    },
  });
  const firstInstanceId = await openReady(harness, { adapter: firstAdapter });
  const accepted = await firstContext.commands.invoke('increment', { by: 2 });
  assert.equal(accepted.ok, true);
  assert.equal(harness.engine.projectInstance(firstInstanceId).value.counter, 2);
  const infrastructure = await firstContext.commands.invoke('simulator.reset', {});
  assert.equal(infrastructure.ok, false);
  assert.equal(infrastructure.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(harness.engine.epoch, 1);

  await harness.host.disposeInstance(firstInstanceId);
  const afterDispose = await firstContext.commands.invoke('increment', { by: 3 });
  assert.equal(afterDispose.ok, false);
  assert.equal(afterDispose.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(firstContext.asyncReservations.reserve({
    commandType: 'increment',
    outcomeSchemaId: 'unused-after-dispose',
  }).error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.throws(() => firstContext.projection.get(), /SIMULATOR_INSTANCE_DISPOSED/u);

  const resetHarness = createHarness();
  let secondContext;
  const secondAdapter = makeAdapter({
    prepare(context) {
      secondContext = context;
      return fixtureCanonicalBindings();
    },
  });
  await openReady(resetHarness, { adapter: secondAdapter });
  const resetReservation = secondContext.asyncReservations.reserve({
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(resetReservation.ok, true);
  let abortSettlement = null;
  let abortCancellation = null;
  secondContext.abortSignal.addEventListener('abort', () => {
    abortSettlement = resetReservation.value.settle({ by: 13 });
    abortCancellation = resetReservation.value.cancel('caller');
  }, { once: true });
  const reset = await resetHarness.engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  assert.deepEqual(abortSettlement, { ok: true, value: { accepted: false } });
  assert.deepEqual(abortCancellation, { ok: true, value: { cancelled: false } });
  assert.deepEqual(resetReservation.value.settle({ by: 17 }), {
    ok: true, value: { accepted: false },
  });
  const afterReset = await secondContext.commands.invoke('increment', { by: 7 });
  assert.equal(afterReset.ok, false);
  assert.equal(afterReset.error.code, 'SIMULATOR_STALE_EPOCH');
  assert.throws(() => secondContext.clock.now(), /SIMULATOR_STALE_EPOCH/u);
});

test('dispose cancels already allocated instance reservations before abort callbacks can settle them', async () => {
  const harness = createHarness();
  let context;
  const adapter = makeAdapter({
    prepare(nextContext) {
      context = nextContext;
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  const settlements = [];
  const head = harness.engine.reserveAsync({
    issuer: { kind: 'shell', moduleId: null, instanceId: null },
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(head.ok, true);
  const reservation = context.asyncReservations.reserve({
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
    onCommandSettlement: (result) => settlements.push(result),
  });
  assert.equal(reservation.ok, true);
  assert.deepEqual(reservation.value.settle({ by: 9 }), {
    ok: true, value: { accepted: true },
  });

  context.abortSignal.addEventListener('abort', () => {
    reservation.value.settle({ by: 11 });
  }, { once: true });
  await harness.host.disposeInstance(instanceId);
  assert.deepEqual(reservation.value.settle({ by: 7 }), {
    ok: true, value: { accepted: false },
  });
  head.value.cancel('caller');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.engine.getCommitted().partitions.modules['fixture-module'].counter, 0);
  assert.deepEqual(settlements, []);
});

test('instance invalidation cancels owned streams before abort and forbids post-dispose items', async () => {
  const harness = createHarness();
  harness.engine.registerStreamMethod({
    methodId: 'fixture-stream',
    ownerModuleId: 'fixture-module',
    sourceEventType: 'fixture-module/counter-changed',
    terminalEventType: null,
    itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
    terminalSchema: { kind: 'json' },
  });
  let context;
  const instanceId = await openReady(harness, {
    adapter: makeAdapter({
      prepare(nextContext) {
        context = nextContext;
        return fixtureCanonicalBindings();
      },
    }),
  });
  const opened = await harness.engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream', ownerInstanceId: instanceId,
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);
  const handle = harness.engine.streamHandle(opened.value.streamId);
  const items = [];
  handle.attach((item) => items.push(item));
  await harness.engine.acceptCommand('simulator.stream.activate', {
    streamId: opened.value.streamId,
  }, SHELL_ISSUER);
  let abortCommand = null;
  context.abortSignal.addEventListener('abort', () => {
    abortCommand = harness.engine.acceptCommand('increment', { by: 1 }, {
      kind: 'instance', moduleId: 'fixture-module', instanceId,
    });
  }, { once: true });

  const disposed = await harness.host.disposeInstance(instanceId);
  assert.equal(disposed.ok, true);
  assert.deepEqual(await handle.completion, { status: 'cancelled', reason: 'dispose' });
  assert.equal((await abortCommand).ok, true, 'abort callback runs only after stream terminalization');
  await harness.engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.deepEqual(items, []);
  assert.equal(harness.engine.streamHandle(opened.value.streamId), null);
});

test('same-turn ready close and scenario reset have one reset-owned cleanup and typed close settlement', async () => {
  const order = [];
  const harness = createHarness({
    prepareSurface: () => ({
      kit: fixtureCanonicalBindings().kit,
      mount: () => {},
      unmount: () => { order.push('surface:unmount'); },
    }),
  });
  const adapter = makeAdapter({ dispose: () => { order.push('adapter:dispose'); } });
  const source = makeModule('fixture-module', adapter, {
    createInstance: () => ({
      surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
      dispose: () => { order.push('canonical:dispose'); },
    }),
  });
  const opened = await harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: async () => source.rendererModule,
    loadAdapter: async () => source.adapterFactory,
    loadStyle: async () => undefined,
  });
  const closing = harness.host.disposeInstance(opened.value.instanceId);
  const resetting = harness.engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  const reset = await resetting;
  const closed = await closing;

  assert.equal(reset.ok, true);
  assert.equal(closed.ok, false);
  assert.equal(closed.error.code, 'SIMULATOR_STALE_EPOCH');
  assert.equal(harness.engine.phase, 'open');
  assert.equal(harness.engine.epoch, 2);
  assert.deepEqual(order, ['surface:unmount', 'canonical:dispose', 'adapter:dispose']);
  assert.deepEqual(harness.integrity, []);
  assert.equal(harness.engine.getCommitted().instance(opened.value.instanceId), null);
});

test('adapter dispose rejection is a session integrity failure', async () => {
  const harness = createHarness();
  const adapter = makeAdapter({
    dispose: () => Promise.reject(new Error('adapter cleanup failed')),
  });
  const instanceId = await openReady(harness, { adapter });
  const disposed = await harness.host.disposeInstance(instanceId);
  assert.equal(disposed.ok, false);
  assert.equal(disposed.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.deepEqual(harness.integrity, ['SIMULATOR_INTEGRITY_FAILURE']);
  assert.equal(harness.engine.phase, 'terminal');
});

test('cleanup watchdog timeout is a session integrity failure', async () => {
  const clock = fakeTimers();
  const harness = createHarness({ timers: clock });
  const adapter = makeAdapter({
    prepare: (context) => {
      context.cleanup.add(() => new Promise(() => {})); // never settles
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  const disposing = harness.host.disposeInstance(instanceId);
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(5001);
  const disposed = await disposing;
  assert.equal(disposed.ok, false);
  assert.equal(disposed.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.deepEqual(harness.integrity, ['SIMULATOR_INTEGRITY_FAILURE']);
  assert.equal(harness.engine.phase, 'terminal');
});

test('event handlers register only during prepare and fire in subscription order', async () => {
  const harness = createHarness();
  const fired = [];
  let captured;
  const adapter = makeAdapter({
    prepare: (context) => {
      captured = context;
      context.events.subscribe('fixture-module/counter-changed', (payload) => fired.push(['first', payload.value]));
      context.events.subscribe('fixture-module/counter-changed', (payload) => fired.push(['second', payload.value]));
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  const late = captured.events.subscribe('fixture-module/counter-changed', () => {});
  assert.equal(late.ok, false);
  assert.equal(late.error.code, 'SIMULATOR_INVALID_LIFECYCLE');

  await harness.engine.acceptCommand('increment', { by: 1 }, { kind: 'instance', moduleId: 'fixture-module', instanceId });
  assert.deepEqual(fired, [['first', 1], ['second', 1]]);
});

test('an event handler throw fails the instance and skips its remaining handlers', async () => {
  const harness = createHarness();
  const fired = [];
  const adapter = makeAdapter({
    prepare: (context) => {
      context.events.subscribe('fixture-module/counter-changed', () => {
        throw new Error('handler fault');
      });
      context.events.subscribe('fixture-module/counter-changed', () => fired.push('after-throw'));
      return fixtureCanonicalBindings();
    },
  });
  const instanceId = await openReady(harness, { adapter });
  await harness.engine.acceptCommand('increment', { by: 1 }, { kind: 'instance', moduleId: 'fixture-module', instanceId });
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fired, []);
  assert.deepEqual(harness.failed, [[instanceId, 'SIMULATOR_INSTANCE_FAILED']]);
  assert.equal(harness.host.phaseOf(instanceId), 'failed');
  assert.deepEqual(harness.integrity, []);
});

test('module load failure fails the instance with a module diagnostic', async () => {
  const harness = createHarness();
  const opened = await harness.host.openInstance({
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
    loadRenderer: () => Promise.reject(new Error('chunk load failed')),
    loadAdapter: () => Promise.resolve({}),
    loadStyle: () => Promise.resolve(undefined),
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.error.code, 'SIMULATOR_MODULE_FAILED');
  const instanceId = opened.error.instanceId;
  assert.equal(harness.host.phaseOf(instanceId), 'failed');
  assert.deepEqual(harness.failed, [[instanceId, 'SIMULATOR_MODULE_FAILED']]);
  assert.equal(harness.engine.getCommitted().instance(instanceId).status, 'failed');
});

test('invalid transitions return SIMULATOR_INVALID_LIFECYCLE and commit nothing', async () => {
  const harness = createHarness();
  const instanceId = await openReady(harness, {});
  const before = harness.engine.getCommitted().revision;
  const invalid = await harness.engine.acceptCommand('simulator.instance.transition', {
    instanceId,
    transition: 'module_loaded',
  }, SHELL_ISSUER);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  assert.equal(harness.engine.getCommitted().revision, before);
});
