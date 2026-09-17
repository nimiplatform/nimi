import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { createOperationCatalog } from '../../src/state-engine/catalog.ts';
import {
  fixtureModule,
  fixtureModuleCatalog,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

function engineWithModule(registration) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, registration);
  return engine;
}

async function activate(engine, moduleId = 'fixture-module') {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId }, SHELL_ISSUER);
}

test('qualified catalog admission is independent from one-time lazy behavior attachment', async () => {
  const definition = fixtureModule();
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  engine.registerModuleCatalog(fixtureModuleCatalog(definition));

  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId: definition.moduleId,
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);

  const beforeAttach = await engine.acceptCommand('simulator.behavior.activate', {
    moduleId: definition.moduleId,
  }, SHELL_ISSUER);
  assert.equal(beforeAttach.ok, false);
  assert.equal(beforeAttach.error.code, 'SIMULATOR_MODULE_FAILED');

  const attached = engine.attachModuleBehavior(definition.moduleId, definition.behavior);
  assert.deepEqual(attached, { ok: true, value: { attached: true } });
  const duplicate = engine.attachModuleBehavior(definition.moduleId, definition.behavior);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'SIMULATOR_INTEGRITY_FAILURE');

  const activated = await engine.acceptCommand('simulator.behavior.activate', {
    moduleId: definition.moduleId,
  }, SHELL_ISSUER);
  assert.equal(activated.ok, true);
  assert.equal(engine.getCommitted().partitions.modules[definition.moduleId].counter, 0);
});

test('a reducer throw commits zero state, revision, and events and terminates integrity', async () => {
  const registration = fixtureModule();
  registration.behavior = {
    ...registration.behavior,
    reduce(state, envelope) {
      if (envelope.type === 'increment') throw new Error('reducer fault');
      return { state, events: [] };
    },
  };
  const terminal = [];
  const engine = createSimulatorStateEngine({
    scenario: fixtureScenario(),
    hooks: { onSessionTerminal: (error) => terminal.push(error.code) },
  });
  registerFixtureModule(engine, registration);
  await activate(engine);
  const before = engine.getCommitted();
  const result = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  const after = engine.getCommitted();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.partitions.modules, before.partitions.modules);
  assert.deepEqual(terminal, ['SIMULATOR_INTEGRITY_FAILURE']);
  assert.equal(engine.phase, 'terminal');
});

test('invalid reducer output state is an integrity failure with zero commits', async () => {
  const registration = fixtureModule();
  registration.behavior = {
    ...registration.behavior,
    reduce(state, envelope) {
      if (envelope.type === 'increment') {
        return { state: { counter: Number.POSITIVE_INFINITY }, events: [] };
      }
      return { state, events: [] };
    },
  };
  const engine = engineWithModule(registration);
  await activate(engine);
  const before = engine.getCommitted();
  const result = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(result.error?.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(engine.getCommitted().revision, before.revision);
});

test('undeclared or invalid events are an integrity failure with zero commits', async () => {
  const registration = fixtureModule();
  registration.behavior = {
    ...registration.behavior,
    reduce(state, envelope) {
      if (envelope.type === 'increment') {
        return { state: { ...state, counter: 9 }, events: [{ type: 'undeclared-event', payload: {} }] };
      }
      return { state, events: [] };
    },
  };
  const engine = engineWithModule(registration);
  await activate(engine);
  const before = engine.getCommitted();
  const result = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(result.error?.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(engine.getCommitted().revision, before.revision);
  assert.deepEqual(engine.getCommitted().partitions.modules['fixture-module'], before.partitions.modules['fixture-module']);
});

test('typed expected failures commit nothing and never terminate the session', async () => {
  const engine = engineWithModule(fixtureModule());
  await activate(engine);
  const before = engine.getCommitted();
  const invalidPayload = await engine.acceptCommand('increment', { by: -1 }, SHELL_ISSUER);
  assert.equal(invalidPayload.error?.code, 'SIMULATOR_INVALID_PAYLOAD');
  const unsupported = await engine.acceptCommand('unknown-command', {}, SHELL_ISSUER);
  assert.equal(unsupported.error?.code, 'SIMULATOR_UNSUPPORTED');
  assert.equal(engine.phase, 'open');
  assert.equal(engine.getCommitted().revision, before.revision);
  const ok = await engine.acceptCommand('increment', { by: 3 }, SHELL_ISSUER);
  assert.equal(ok.ok, true);
});

test('catalog rejects duplicate owners, wildcard and cross-partition write sets', () => {
  const catalog = createOperationCatalog();
  catalog.registerCommand({
    kind: 'command',
    type: 'a',
    owner: { kind: 'module', moduleId: 'm' },
    payloadSchema: { kind: 'json' },
    writeSet: ['modules'],
    requiredCapabilities: [],
  });
  assert.throws(() => catalog.registerCommand({
    kind: 'command',
    type: 'a',
    owner: { kind: 'shell' },
    payloadSchema: { kind: 'json' },
    writeSet: ['shell'],
    requiredCapabilities: [],
  }), /duplicate operation type/);
  assert.throws(() => catalog.registerCommand({
    kind: 'command',
    type: 'b',
    owner: { kind: 'module', moduleId: 'm' },
    payloadSchema: { kind: 'json' },
    writeSet: ['modules', 'ecosystem'],
    requiredCapabilities: [],
  }), /only their own modules partition/);
  assert.throws(() => catalog.registerCommand({
    kind: 'command',
    type: 'c',
    owner: { kind: 'shell' },
    payloadSchema: { kind: 'json' },
    writeSet: [],
    requiredCapabilities: [],
  }), /empty write set/);
});

test('module reducers cannot observe another module partition', async () => {
  const first = fixtureModule('module-a', { orderingKey: 0 });
  const second = fixtureModule('module-b', { orderingKey: 1 });
  second.commandSchemas = {
    'b-ping': { kind: 'object', properties: {} },
  };
  second.queries = {};
  second.behavior = {
    ...second.behavior,
    reduce(state, envelope, context) {
      // sharedProjection is the declared shared read surface: the ecosystem
      // partition only, never another module's private state.
      assert.deepEqual(context.sharedProjection, { shared: 0 });
      assert.equal(envelope.type, 'b-ping');
      return { state, events: [] };
    },
  };
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, first);
  registerFixtureModule(engine, second);
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'module-a' }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'module-b' }, SHELL_ISSUER);
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'module-b',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  const result = await engine.acceptCommand('b-ping', {}, {
    kind: 'instance',
    moduleId: 'module-b',
    instanceId: opened.value.instanceId,
  });
  assert.equal(result.ok, true);
  // module-a's private partition is untouched and invisible to module-b.
  assert.deepEqual(engine.getCommitted().partitions.modules['module-a'], { counter: 0, moduleData: null });
});

test('frozen committed state rejects reducer mutation attempts', async () => {
  const registration = fixtureModule();
  let mutationError = null;
  registration.behavior = {
    ...registration.behavior,
    reduce(state, envelope) {
      if (envelope.type === 'increment') {
        try {
          state.counter = 999;
        } catch (error) {
          mutationError = error;
        }
        return { state: { ...state, counter: state.counter + 1 }, events: [] };
      }
      return { state, events: [] };
    },
  };
  const engine = engineWithModule(registration);
  await activate(engine);
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.ok(mutationError instanceof TypeError);
  assert.equal(engine.phase, 'open');
});

test('accepted JSON is detached and each public committed snapshot is recursively immutable and stable', async () => {
  const engine = engineWithModule(fixtureModule());
  await activate(engine);
  const initialRoute = {
    pathname: '/accepted',
    search: [{ key: 'mode', value: 'fixture' }],
    fragment: null,
  };
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute,
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);
  const instanceId = opened.value.instanceId;
  const committed = engine.getCommitted();

  initialRoute.pathname = '/mutated-by-caller';
  initialRoute.search[0].value = 'mutated-by-caller';
  assert.equal(committed.instance(instanceId).route.pathname, '/accepted');
  assert.equal(committed.instance(instanceId).route.search[0].value, 'fixture');
  assert.throws(() => {
    committed.partitions.instances[instanceId].status = 'disposed';
  }, TypeError);
  assert.throws(() => {
    committed.partitions.modules.injected = { value: 1 };
  }, TypeError);
  assert.throws(() => {
    committed.random.state[0] = '0000000000000000';
  }, TypeError);

  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(committed.revision, 2, 'the prior snapshot revision is stable');
  assert.equal(committed.partitions.modules['fixture-module'].counter, 0);
  assert.equal(engine.getCommitted().partitions.modules['fixture-module'].counter, 1);
});

test('declared queries share FIFO ordering and read only cataloged projections', async () => {
  const engine = engineWithModule(fixtureModule());
  await activate(engine);
  await engine.acceptCommand('increment', { by: 4 }, SHELL_ISSUER);
  const order = [];
  const command = engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER).then((result) => {
    order.push('command');
    return result;
  });
  const query = engine.acceptQuery('read-counter', {}, SHELL_ISSUER).then((result) => {
    order.push('query');
    return result;
  });
  await Promise.all([command, query]);
  assert.deepEqual(order, ['command', 'query']);
  assert.equal(query && (await query).value.counter, 5);
});

test('selector throw is an integrity failure', async () => {
  const registration = fixtureModule();
  registration.queries = {
    explode: {
      inputSchema: { kind: 'object', properties: {} },
      projectionSchema: { kind: 'json' },
      select: () => {
        throw new Error('selector fault');
      },
    },
  };
  const engine = engineWithModule(registration);
  await activate(engine);
  const result = await engine.acceptQuery('explode', {}, SHELL_ISSUER);
  assert.equal(result.error?.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(engine.phase, 'terminal');
});
