import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { simulatorError } from '../../src/state-engine/errors.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SCENARIO_ISSUER,
  SHELL_ISSUER,
} from './fixtures.mjs';

function createEngine(hooks = {}, modules = [fixtureModule()]) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario(), hooks });
  for (const definition of modules) registerFixtureModule(engine, definition);
  return engine;
}

async function activate(engine, moduleId = 'fixture-module') {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId }, SHELL_ISSUER);
}

test('reset linearizes at queue head, increments epoch, and reopens admission', async () => {
  const disposed = [];
  const engine = createEngine({
    disposeInstancesForReset: async (instances) => {
      disposed.push(...instances.map((instance) => instance.instanceId));
    },
  });
  await activate(engine);
  await engine.acceptCommand('increment', { by: 5 }, SHELL_ISSUER);
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  assert.equal(opened.value.instanceId, '1:instance:1');

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  assert.deepEqual(reset.value, { epoch: 2, revision: 0 });
  assert.equal(engine.epoch, 2);
  assert.equal(engine.getCommitted().revision, 0);
  assert.deepEqual(disposed, ['1:instance:1']);
  assert.deepEqual(engine.getCommitted().partitions.instances, {});
  // Loaded behaviors reconstruct to declared initial state in the new epoch.
  assert.deepEqual(engine.getCommitted().partitions.modules['fixture-module'], { counter: 0, moduleData: null });

  // Admission reopens: new work commits in the new epoch with fresh sequences.
  const after = await engine.acceptCommand('increment', { by: 2 }, SHELL_ISSUER);
  assert.equal(after.ok, true);
  assert.deepEqual(after.value.eventIds, ['2:evt:1']);
});

test('detached tail settles SIMULATOR_STALE_EPOCH after the reset result', async () => {
  const engine = createEngine();
  await activate(engine);
  const order = [];
  const settled = [];
  let fired = false;
  // Enqueue reset and a two-operation tail from inside the drain (a state
  // subscriber), so the tail is still queued when reset reaches the head.
  engine.subscribeState(() => {
    if (fired || engine.getCommitted().revision !== 2) return;
    fired = true;
    void engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER).then((result) => {
      order.push(['reset', result.ok ? 'ok' : result.error.code]);
      settled.push(result);
    });
    for (const by of [1, 2]) {
      void engine.acceptCommand('increment', { by }, SHELL_ISSUER).then((result) => {
        order.push(['tail', result.ok ? 'ok' : result.error.code]);
        settled.push(result);
      });
    }
  });
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  // Allow the barrier and all settlement continuations to complete.
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.epoch, 2);
  assert.deepEqual(order, [
    ['reset', 'ok'],
    ['tail', 'SIMULATOR_STALE_EPOCH'],
    ['tail', 'SIMULATOR_STALE_EPOCH'],
  ]);
  assert.equal(settled.length, 3);
});

test('admission closes during the barrier and old-epoch tokens are stale', async () => {
  let barrierRelease;
  const barrierGate = new Promise((resolve) => {
    barrierRelease = resolve;
  });
  const engine = createEngine({
    disposeInstancesForReset: async () => {
      await barrierGate;
    },
  });
  await activate(engine);
  const resetPromise = engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  // Wait until the reset op is accepted and linearization ran.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.phase, 'resetting');

  const during = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(during.ok, false);
  assert.equal(during.error.code, 'SIMULATOR_STALE_EPOCH');
  assert.equal(during.error.operationId, null);

  const reservedDuring = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(reservedDuring.ok, false);
  assert.equal(reservedDuring.error.code, 'SIMULATOR_STALE_EPOCH');

  barrierRelease();
  const reset = await resetPromise;
  assert.equal(reset.ok, true);
  assert.equal(engine.phase, 'open');
});

test('cleanup failure is a terminal integrity failure; admission never reopens', async () => {
  const terminal = [];
  const engine = createEngine({
    disposeInstancesForReset: async () => {
      throw new Error('cleanup rejected');
    },
    onSessionTerminal: (error) => terminal.push(error.code),
  });
  await activate(engine);
  await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);

  const order = [];
  let fired = false;
  engine.subscribeState(() => {
    if (fired || engine.getCommitted().revision !== 3) return;
    fired = true;
    void engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER).then((result) => {
      order.push(['reset', result.ok ? 'ok' : result.error.code]);
    });
    void engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER).then((result) => {
      order.push(['tail', result.ok ? 'ok' : result.error.code]);
    });
  });
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, [
    ['reset', 'SIMULATOR_INTEGRITY_FAILURE'],
    ['tail', 'SIMULATOR_INTEGRITY_FAILURE'],
  ]);
  assert.deepEqual(terminal, ['SIMULATOR_INTEGRITY_FAILURE']);
  assert.equal(engine.phase, 'terminal');
  const after = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(after.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
});

test('reset cleanup starts outside the FIFO drain and cannot reopen after an independent terminal transition', async () => {
  let engine;
  let acceptReturned = false;
  let cleanupRanBeforeAcceptReturned = null;
  const terminal = [];
  engine = createEngine({
    disposeInstancesForReset: async () => {
      cleanupRanBeforeAcceptReturned = !acceptReturned;
      engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        instanceId: '1:instance:1',
      }));
    },
    onSessionTerminal: (error) => terminal.push(error.code),
  });
  await activate(engine);
  await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);

  const resetting = engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  acceptReturned = true;
  const result = await resetting;
  assert.equal(cleanupRanBeforeAcceptReturned, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(engine.phase, 'terminal');
  assert.deepEqual(terminal, ['SIMULATOR_INTEGRITY_FAILURE']);
});

test('reset cancels jobs, reservations, and streams; nothing stays pending', async () => {
  const engine = createEngine();
  engine.registerStreamMethod({
    methodId: 'fixture-stream',
    ownerModuleId: 'fixture-module',
    sourceEventType: 'fixture-module.counter.changed',
    terminalEventType: null,
    itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
    terminalSchema: { kind: 'json' },
  });
  await activate(engine);

  await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 1 },
    causationId: null,
    delayMs: 1000,
  }, SHELL_ISSUER);
  const reservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  const opened = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream',
    ownerInstanceId: null,
  }, SHELL_ISSUER);
  const streamId = opened.value.streamId;
  const handle = engine.streamHandle(streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  assert.deepEqual(await handle.completion, { status: 'cancelled', reason: 'reset' });
  assert.deepEqual(reservation.value.cancel('reset'), { ok: true, value: { cancelled: false } });
  assert.equal(engine.getCommitted().logicalTime, 0);
  // The cancelled job never fires after reset.
  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 5000 }, SCENARIO_ISSUER);
  const counter = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(counter.value.counter, 0);
});

test('reset reconstructs epoch-owned clock, stream, and reservation registries', async () => {
  const engine = createEngine();
  engine.registerStreamMethod({
    methodId: 'fixture-stream',
    ownerModuleId: 'fixture-module',
    sourceEventType: 'fixture-module.counter.changed',
    terminalEventType: null,
    itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
    terminalSchema: { kind: 'json' },
  });
  await activate(engine);

  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1000 }, SCENARIO_ISSUER);
  const oldStream = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream',
    ownerInstanceId: null,
  }, SHELL_ISSUER);
  const oldReservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(oldStream.value.streamId, '1:stream:1');
  assert.equal(engine.streamRegistry.get(oldStream.value.streamId).allocationSequence, 1);
  assert.equal(oldReservation.value.reservationId, '1:async:1');

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.deepEqual(reset.value, { epoch: 2, revision: 0 });
  assert.equal(engine.getCommitted().logicalTime, 0);
  assert.deepEqual(oldReservation.value.cancel('reset'), { ok: true, value: { cancelled: false } });

  const advanced = await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 5 }, SCENARIO_ISSUER);
  assert.equal(advanced.ok, true);
  assert.equal(engine.getCommitted().logicalTime, 5);

  const newStream = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream',
    ownerInstanceId: null,
  }, SHELL_ISSUER);
  assert.equal(newStream.value.streamId, '2:stream:1');
  assert.equal(engine.streamRegistry.get(newStream.value.streamId).allocationSequence, 1);

  const settlements = [];
  const newReservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
    onCommandSettlement: (settlement) => settlements.push(settlement),
  });
  assert.equal(newReservation.value.reservationId, '2:async:1');
  assert.deepEqual(newReservation.value.settle({ by: 3 }), { ok: true, value: { accepted: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].ok, true);
  const counter = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(counter.value.counter, 3);
});

test('loaded behaviors reconstruct in registry order; never-loaded stay unloaded', async () => {
  const order = [];
  const moduleA = fixtureModule('module-a', { orderingKey: 0 });
  const moduleB = fixtureModule('module-b', { orderingKey: 1 });
  for (const registration of [moduleA, moduleB]) {
    const behavior = registration.behavior;
    registration.behavior = {
      ...behavior,
      initialState(input) {
        order.push(registration.moduleId);
        return behavior.initialState(input);
      },
    };
    registration.queries = {};
    registration.commandSchemas = registration.moduleId === 'module-a'
      ? registration.commandSchemas
      : { 'b-touch': { kind: 'object', properties: {} } };
  }
  moduleB.behavior = {
    ...moduleB.behavior,
    reduce(state) {
      return { state, events: [] };
    },
  };
  const engine = createEngine({}, [moduleA, moduleB]);
  await activate(engine, 'module-a');
  order.length = 0;
  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  assert.deepEqual(order, ['module-a']);
  const partitions = engine.getCommitted().partitions.modules;
  assert.ok('module-a' in partitions);
  assert.equal('module-b' in partitions, false);
});

test('reset invalidates readiness, event subscribers, and instance tokens via hooks', async () => {
  const invalidated = [];
  const engine = createEngine({
    invalidateEpoch: (oldEpoch, newEpoch) => invalidated.push([oldEpoch, newEpoch]),
  });
  await activate(engine);
  await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.deepEqual(invalidated, [[1, 2]]);
});

test('instance reset hooks do not exist; recreation is dispose plus open', async () => {
  const engine = createEngine();
  await activate(engine);
  const first = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  const disposed = await engine.acceptCommand('simulator.instance.transition', {
    instanceId: first.value.instanceId,
    transition: 'dispose',
  }, SHELL_ISSUER);
  assert.equal(disposed.ok, true);
  await engine.acceptCommand('simulator.instance.disposed', { instanceId: first.value.instanceId }, SHELL_ISSUER);
  const second = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  assert.notEqual(second.value.instanceId, first.value.instanceId);
  assert.equal(engine.epoch, 1);
});
