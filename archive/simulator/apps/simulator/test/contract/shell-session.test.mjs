import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  createSimulatorSession,
  parseShellRoute,
  serializeShellRoute,
} from '../../src/shell/session.ts';
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

function registryRow(moduleId, moduleSource) {
  return {
    metadata: {
      moduleId,
      orderingKey: 0,
      surfaces: [{
        id: 'main',
        label: 'Main',
        initialRoute: '/',
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
        prepare: behavior.prepare ?? ((context) => {
          behavior.capturePrepareContext?.(context);
          return fixtureCanonicalBindings();
        }),
        activate: behavior.activate ?? (() => {}),
        deactivate: behavior.deactivate ?? (() => {}),
        dispose: behavior.dispose ?? (() => {}),
      }),
    },
  };
}

function createSession({
  modules = [],
  registryRows = [],
  onRouteChange,
  writeRoute,
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
    onRouteChange,
    writeRoute,
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

test('full-window routes project one instance, write a deep link, and exit on close', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const projected = [];
  const written = [];
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
    onRouteChange: (route) => projected.push(route),
    writeRoute: (path, replace) => written.push({ path, replace }),
  });
  const opened = await session.openInstance(moduleId);
  session.navigate({
    kind: 'instance',
    instanceId: opened.value.instanceId,
    appRoute: {
      pathname: '/details',
      search: [{ key: 'view', value: 'first' }, { key: 'view', value: 'second' }],
      fragment: 'section one',
    },
  });
  assert.deepEqual(session.route(), {
    kind: 'instance',
    instanceId: opened.value.instanceId,
    appRoute: {
      pathname: '/details',
      search: [{ key: 'view', value: 'first' }, { key: 'view', value: 'second' }],
      fragment: 'section one',
    },
  });
  assert.deepEqual(projected.at(-1), session.route());
  assert.deepEqual(written.at(-1), {
    path: `/instance/${encodeURIComponent(opened.value.instanceId)}/details?view=first&view=second#section%20one`,
    replace: false,
  });
  assert.equal(session.engine.getCommitted().instance(opened.value.instanceId).route.pathname, '/details');
  await session.closeInstance(opened.value.instanceId);
  assert.equal(session.route().kind, 'home');
  assert.deepEqual(written.at(-1), { path: '/', replace: true });
});

test('Shell deep links preserve ordered query entries and the fragment', () => {
  const route = {
    kind: 'instance',
    instanceId: '3:instance:17',
    appRoute: {
      pathname: '/settings/profile',
      search: [{ key: 'tab', value: 'one' }, { key: 'tab', value: 'two' }],
      fragment: 'profile controls',
    },
  };
  const serialized = serializeShellRoute(route);
  assert.equal(serialized, '/instance/3%3Ainstance%3A17/settings/profile?tab=one&tab=two#profile%20controls');
  assert.deepEqual(parseShellRoute({
    pathname: '/instance/3%3Ainstance%3A17/settings/profile',
    search: '?tab=one&tab=two',
    hash: '#profile%20controls',
  }), route);
  assert.equal(parseShellRoute({ pathname: '/instance/not-an-instance', search: '', hash: '' }), null);
  assert.equal(parseShellRoute({ pathname: '/instance/3%3Ainstance%3A17//authority', search: '', hash: '' }), null);
  assert.equal(parseShellRoute({ pathname: '/instance/3%3Ainstance%3A17/%2e%2e/escape', search: '', hash: '' }), null);
});

test('an App-originated route update replaces the active full-window URL', async () => {
  const moduleId = 'fixture-module';
  let adapterContext = null;
  const row = registryRow(moduleId, moduleSourceFor(moduleId, {
    capturePrepareContext: (context) => { adapterContext = context; },
  }));
  const written = [];
  const { session } = createSession({
    modules: [fixtureModule()],
    registryRows: [row],
    writeRoute: (path, replace) => written.push({ path, replace }),
  });
  const opened = await session.openInstance(moduleId);
  session.navigate({
    kind: 'instance',
    instanceId: opened.value.instanceId,
    appRoute: { pathname: '/', search: [], fragment: null },
  });
  const navigated = await adapterContext.route.navigate({
    pathname: '/inside-app',
    search: [{ key: 'mode', value: 'inspect' }],
    fragment: 'result',
  });
  assert.equal(navigated.ok, true);
  assert.deepEqual(session.route(), {
    kind: 'instance',
    instanceId: opened.value.instanceId,
    appRoute: {
      pathname: '/inside-app',
      search: [{ key: 'mode', value: 'inspect' }],
      fragment: 'result',
    },
  });
  assert.deepEqual(written.at(-1), {
    path: `/instance/${encodeURIComponent(opened.value.instanceId)}/inside-app?mode=inspect#result`,
    replace: true,
  });
});

test('a deep link selected before launch is applied after its deterministic instance opens', async () => {
  const moduleId = 'fixture-module';
  const row = registryRow(moduleId, moduleSourceFor(moduleId));
  const { session } = createSession({ modules: [fixtureModule()], registryRows: [row] });
  const appRoute = {
    pathname: '/deep',
    search: [{ key: 'from', value: 'shell' }],
    fragment: 'target',
  };
  session.navigate({ kind: 'instance', instanceId: '1:instance:1', appRoute }, { history: false });
  const opened = await session.openInstance(moduleId);
  assert.equal(opened.ok, true);
  assert.deepEqual(session.engine.getCommitted().instance(opened.value.instanceId).route, appRoute);
  assert.deepEqual(session.route(), { kind: 'instance', instanceId: opened.value.instanceId, appRoute });
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
  await session.closeInstance(opened.value.instanceId);
  const terminal = await barrier.completion;
  assert.equal(terminal.state, 'cancelled');
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
  session.navigate({
    kind: 'instance',
    instanceId: '1:instance:1',
    appRoute: { pathname: '/', search: [], fragment: null },
  });
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
  });
  const opened = await session.openInstance(moduleId);
  const barrier = session.readinessFor(opened.value.instanceId, 'main').value;

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
  });
  const opened = await session.openInstance(moduleId);
  const barrier = session.readinessFor(opened.value.instanceId, 'main').value;

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
