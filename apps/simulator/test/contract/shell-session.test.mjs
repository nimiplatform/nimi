import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { createSimulatorSession } from '../../src/shell/session.ts';
import { createGlobalListenerCoordinator } from '../../src/shell/global-coordinator.ts';
import { generateEffectCatalog } from '../../build/generate-effect-catalog.mjs';
import {
  fixtureCanonicalBindings,
  fixtureModule,
  fixtureModuleCatalog,
  fixtureScenario,
} from './fixtures.mjs';

const catalog = generateEffectCatalog({ write: false });

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
  };
}

function readinessBrowser() {
  let frame = 0;
  return {
    awaitCommit: async (floor) => floor + 1,
    nextAnimationFrame: async () => { frame += 1; return frame; },
    beginPaintComposite: async () => 'fixture-paint-window',
    markPaintCompositeFrame: async () => true,
    observePaintComposite: async () => true,
    checkSemanticMarkers: async () => ({ ok: true }),
  };
}

function registryRow(moduleId, moduleSource) {
  return {
    metadata: {
      moduleId,
      orderingKey: 0,
      surfaces: [{
        id: 'main',
        label: 'Main',
        initialRoute: '/',
        readinessContractId: 'fixture-readiness-v1',
      }],
      requirements: {
        kitCapabilities: [],
        sdkMethods: [],
        commands: [],
        events: [],
      },
    },
    loadRenderer: async () => moduleSource.rendererModule,
    loadAdapter: async () => moduleSource.adapterFactory,
    loadStyle: async () => '',
  };
}

function moduleSourceFor(moduleId, behavior = {}) {
  return {
    rendererModule: {
      protocol: 'nimi.simulator.module/v1',
      moduleId,
      factory: {
        factoryId: `${moduleId}-factory`,
        createInstance: () => ({
          surfaces: Object.freeze({ main: { id: 'main', render: () => null } }),
          dispose: () => { behavior.canonicalDisposals ? behavior.canonicalDisposals.count += 1 : undefined; },
        }),
      },
    },
    adapterFactory: {
      protocol: 'nimi.simulator.module/v1',
      moduleId,
      behavior: fixtureModule(moduleId).behavior,
      create: () => ({
        prepare: behavior.prepare ?? (() => fixtureCanonicalBindings()),
        activate: behavior.activate ?? (() => {}),
        deactivate: behavior.deactivate ?? (() => {}),
        dispose: behavior.dispose ?? (() => {}),
      }),
    },
  };
}

const READINESS_DECLARATION = {
  contractId: 'fixture-readiness-v1',
  surfaceId: 'main',
  rootContentSemanticId: 'fixture-root',
  primaryControl: { semanticId: 'fixture-primary', ariaRole: 'button', accessibleName: 'Run fixture' },
};

const READINESS_EXPECTATION = {
  contractId: 'fixture-readiness-v1',
  rootContentSemanticId: 'fixture-root',
  primaryControl: READINESS_DECLARATION.primaryControl,
  projectionPredicateId: 'fixture-projection',
  blockingStatePredicateId: 'fixture-not-blocked',
};

function createSession({
  modules = [],
  registryRows = [],
  readiness = true,
  readinessBrowserPort = readinessBrowser(),
} = {}) {
  const clock = fakeTimers();
  const session = createSimulatorSession({
    scenario: fixtureScenario(),
    registryModules: registryRows,
    moduleCatalogs: modules.map(fixtureModuleCatalog),
    timers: clock.timers,
    effectScope: { run: (_owner, _phase, callback) => callback() },
    prepareSurface: () => ({
      kit: fixtureCanonicalBindings().kit,
      mount: () => {},
      unmount: () => {},
    }),
    readinessBrowser: readinessBrowserPort,
    commitToken: () => 1,
    simulationDisclosureVisible: () => true,
    readinessDeclarations: readiness ? { 'fixture-module/main': READINESS_DECLARATION } : {},
    readinessExpectations: readiness ? { 'fixture-module/main': READINESS_EXPECTATION } : {},
    readinessProjectionPredicates: readiness ? { 'fixture-projection': () => true } : {},
    readinessBlockingPredicates: readiness ? { 'fixture-not-blocked': () => false } : {},
  });
  return { session, clock };
}

test('empty shell session loads with no App graph and reports diagnostics', async () => {
  const { session } = createSession({ modules: [fixtureModule()] });
  assert.equal(session.phase, 'open');
  assert.equal(session.epoch, 1);
  assert.deepEqual(session.instances(), []);
  assert.deepEqual(session.diagnostics.list(), []);
  assert.equal(session.route().kind, 'home');

  session.navigate({ kind: 'diagnostics' });
  assert.equal(session.route().kind, 'diagnostics');

  const unsupported = await session.openInstance('no-such-module');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'SIMULATOR_UNSUPPORTED');
});

test('shell opens, activates, and closes an instance from the generated registry', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
  });
  const opened = await session.openInstance(moduleId);
  assert.equal(opened.ok, true);
  const { instanceId } = opened.value;
  assert.match(instanceId, /^1:instance:1$/);

  const instances = session.instances();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].status, 'inactive');

  const activated = await session.activateInstance(instanceId);
  assert.deepEqual(activated.value, { activated: true });

  const closed = await session.closeInstance(instanceId);
  assert.deepEqual(closed.value, { disposed: true });
  assert.deepEqual(session.instances().map((instance) => instance.status), ['disposed']);
});

test('readiness barriers are session-owned and cancel on close', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
  });
  const opened = await session.openInstance(moduleId);
  const barrierResult = session.readinessFor(opened.value.instanceId, 'main');
  assert.equal(barrierResult.ok, true);
  const barrier = barrierResult.value;
  const signaled = barrier.signalCandidate({ contractId: 'fixture-readiness-v1' });
  assert.equal(signaled.ok, true);
  await session.closeInstance(opened.value.instanceId);
  const terminal = await barrier.completion;
  assert.equal(terminal.state, 'cancelled');
});

test('missing readiness authority fails the session closed instead of synthesizing a contract', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
    readiness: false,
  });
  const opened = await session.openInstance(moduleId);
  const result = session.readinessFor(opened.value.instanceId, 'main');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(session.phase, 'terminal');
});

test('scenario reset disposes instances and returns the shell home', async () => {
  const moduleId = 'fixture-module';
  const canonicalDisposals = { count: 0 };
  const row = registryRow(moduleId, moduleSourceFor(moduleId, { canonicalDisposals }));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
  });
  await session.openInstance(moduleId);
  session.navigate({ kind: 'instance', instanceId: '1:instance:1', appPath: '/' });
  const reset = await session.resetScenario();
  assert.equal(reset.ok, true);
  assert.equal(session.epoch, 2);
  assert.equal(canonicalDisposals.count, 1);
  assert.deepEqual(session.instances(), []);
  assert.equal(session.route().kind, 'home');
});

test('scenario reset result is observable before readiness reset completion', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
    readinessBrowserPort: {
      ...readinessBrowser(),
      awaitCommit: () => new Promise(() => {}),
    },
  });
  const opened = await session.openInstance(moduleId);
  const barrier = session.readinessFor(opened.value.instanceId, 'main').value;
  barrier.signalCandidate({ contractId: 'fixture-readiness-v1' });

  const order = [];
  const readiness = barrier.completion.then((terminal) => {
    order.push('readiness');
    return terminal;
  });
  const reset = session.resetScenario().then((result) => {
    order.push('reset');
    return result;
  });
  assert.equal((await reset).ok, true);
  assert.equal((await readiness).reason, 'reset');
  assert.deepEqual(order, ['reset', 'readiness']);
});

test('failed reset still settles invalidated readiness after the reset result', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId, {
    dispose: () => { throw new Error('fixture adapter dispose failure'); },
  }));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
    readinessBrowserPort: {
      ...readinessBrowser(),
      awaitCommit: () => new Promise(() => {}),
    },
  });
  const opened = await session.openInstance(moduleId);
  const barrier = session.readinessFor(opened.value.instanceId, 'main').value;
  barrier.signalCandidate({ contractId: 'fixture-readiness-v1' });

  const order = [];
  const readiness = barrier.completion.then((terminal) => {
    order.push('readiness');
    return terminal;
  });
  const reset = session.resetScenario().then((result) => {
    order.push('reset');
    return result;
  });
  const resetResult = await reset;
  assert.equal(resetResult.ok, false);
  assert.equal(resetResult.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  const readinessResult = await Promise.race([
    readiness,
    new Promise((resolve) => setImmediate(() => resolve(null))),
  ]);
  assert.deepEqual(readinessResult, {
    state: 'cancelled', reason: 'reset', markedAtLogicalTime: null,
  });
  assert.deepEqual(order, ['reset', 'readiness']);
  assert.equal(session.phase, 'terminal');
});

test('session terminal failure reports a session diagnostic', async () => {
  const definition = fixtureModule();
  const { session } = createSession({ modules: [definition] });
  const attached = session.engine.attachModuleBehavior(definition.moduleId, definition.behavior);
  assert.equal(attached.ok, true);
  session.engine.subscribeState(() => {
    void session.engine.acceptCommand('increment', { by: 1 }, { kind: 'shell', moduleId: null, instanceId: null });
  });
  await session.engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, {
    kind: 'shell', moduleId: null, instanceId: null,
  });
  assert.equal(session.phase, 'terminal');
  const terminal = session.diagnostics.sessionTerminal();
  assert.ok(terminal);
  assert.equal(terminal.scope, 'session');
  assert.equal(terminal.code, 'SIMULATOR_INTEGRITY_FAILURE');
});

test('listener coordinator owns exactly one physical listener per family', () => {
  const installed = [];
  const removed = [];
  function makeTarget(name) {
    return {
      addEventListener: (type, handler, options) => installed.push({ target: name, type, handler, options }),
      removeEventListener: (type) => removed.push([name, type]),
    };
  }
  const targets = { window: makeTarget('window'), document: makeTarget('document') };
  const coordinator = createGlobalListenerCoordinator(
    catalog.listenerFamilies.map((family) => ({
      id: family.id,
      eventTarget: family.eventTarget,
      eventTypes: family.eventTypes,
      capture: family.capture,
      passive: family.passive,
      owner: family.owner,
    })),
    targets,
    { run: (_owner, _phase, callback) => callback() },
  );
  const events = [];
  const first = coordinator.subscribeFamily('route_history', (event) => events.push(['a', event]));
  const second = coordinator.subscribeFamily('route_history', (event) => events.push(['b', event]));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // One physical popstate listener on window for both subscribers.
  assert.equal(installed.filter((entry) => entry.target === 'window' && entry.type === 'popstate').length, 1);
  assert.equal(coordinator.familyListenerCount('route_history'), 1);

  installed[0].handler({ type: 'popstate' });
  assert.deepEqual(events.map(([subscriber]) => subscriber), ['a', 'b']);

  // Unknown family fails closed; no listener installed.
  const unknown = coordinator.subscribeFamily('not-a-family', () => {});
  assert.equal(unknown.ok, false);

  first.value();
  second.value();
  assert.equal(coordinator.totalInstalledListeners(), 0);
  assert.equal(removed.filter(([target, type]) => target === 'window' && type === 'popstate').length, 1);
});

test('engine and session share one committed truth for instance presentation', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
  });
  const opened = await session.openInstance(moduleId);
  const fromEngine = session.engine.getCommitted().instance(opened.value.instanceId);
  assert.equal(fromEngine.moduleId, moduleId);
  assert.equal(fromEngine.status, 'inactive');
});

test('state engine replay digest remains stable with the shell session attached', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
  });
  await session.openInstance(moduleId);
  await session.engine.acceptCommand('increment', { by: 1 }, { kind: 'shell', moduleId: null, instanceId: null });
  const record = session.engine.buildReplayRecord();
  const digest = session.engine.replayRecordDigest(record);
  const { replaySimulatorSession } = await import('../../src/state-engine/replay.ts');
  const outcome = await replaySimulatorSession(record, {
    scenario: fixtureScenario(),
    modules: [fixtureModule()],
  });
  assert.equal(outcome.matches, true);
  assert.equal(session.engine.replayRecordDigest(), digest);
});
