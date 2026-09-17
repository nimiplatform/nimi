import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SCENARIO_ISSUER,
  SHELL_ISSUER,
} from './fixtures.mjs';

function createEngine(hooks = undefined) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario(), hooks });
  registerFixtureModule(engine, fixtureModule());
  return engine;
}

async function openLiveInstance(engine) {
  await activate(engine);
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);
  return opened.value.instanceId;
}

async function activate(engine) {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
}

function reserve(engine, by = 1) {
  const result = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(result.ok, true);
  return result.value;
}

test('two reservations settled in reverse promise order release in allocation order', async () => {
  const engine = createEngine();
  await activate(engine);
  const first = reserve(engine);
  const second = reserve(engine);

  // Reverse settlement order: second settles first and must buffer.
  assert.deepEqual(second.settle({ by: 10 }), { ok: true, value: { accepted: true } });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 0);
  assert.equal(engine.isQuiescent(), true); // open external reservations do not block quiescence

  assert.deepEqual(first.settle({ by: 1 }), { ok: true, value: { accepted: true } });
  // Both released commands committed in allocation order: +1 then +10.
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 11);
});

test('a later ready completion stays buffered behind an earlier live reservation', async () => {
  const engine = createEngine();
  await activate(engine);
  const first = reserve(engine);
  const second = reserve(engine);
  const third = reserve(engine);

  second.settle({ by: 10 });
  third.settle({ by: 100 });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 0);

  first.settle({ by: 1 });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 111);
});

test('cancellation from open and settled-but-unreleased advances later slots without renumbering', async () => {
  const engine = createEngine();
  await activate(engine);
  const first = reserve(engine);
  const second = reserve(engine);
  const third = reserve(engine);

  second.settle({ by: 10 });
  // Cancel the open head: the buffered second slot releases next.
  assert.deepEqual(first.cancel('caller'), { ok: true, value: { cancelled: true } });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 10);
  // Third was still open behind the released second; settle releases it now.
  third.settle({ by: 100 });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 110);

  assert.deepEqual(first.cancel('caller'), { ok: true, value: { cancelled: false } });
  assert.deepEqual(first.settle({ by: 1 }), { ok: true, value: { accepted: false } });
});

test('double settlement and cancellation after release return specified false results', async () => {
  const engine = createEngine();
  await activate(engine);
  const reservation = reserve(engine);
  assert.deepEqual(reservation.settle({ by: 1 }), { ok: true, value: { accepted: true } });
  assert.deepEqual(reservation.settle({ by: 2 }), { ok: true, value: { accepted: false } });
  assert.deepEqual(reservation.cancel('caller'), { ok: true, value: { cancelled: false } });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 1);
});

test('invalid outcomes and raw rejection-shaped payloads fail schema validation', async () => {
  const engine = createEngine();
  await activate(engine);
  const reservation = reserve(engine);
  const invalid = reservation.settle({ status: 'succeeded', by: 'one' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  const raw = reservation.settle({ by: 1, error: 'Connection refused at 10.0.0.1' });
  assert.equal(raw.ok, false);
  // The reservation is still open after rejected settlements.
  assert.deepEqual(reservation.settle({ by: 1 }), { ok: true, value: { accepted: true } });
});

test('reservation handles are one-shot and epoch-independent after terminal states', async () => {
  const engine = createEngine();
  await activate(engine);
  const reservation = reserve(engine);
  assert.match(reservation.reservationId, /^1:async:1$/);
  reservation.cancel('caller');
  assert.deepEqual(reservation.settle({ by: 1 }), { ok: true, value: { accepted: false } });
  assert.deepEqual(reservation.cancel('reset'), { ok: true, value: { cancelled: false } });
});

test('released command results forward to the reservation sink', async () => {
  const engine = createEngine();
  await activate(engine);
  const settlements = [];
  const result = engine.reserveAsync({
    issuer: SCENARIO_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
    onCommandSettlement: (settlement) => settlements.push(settlement),
  });
  assert.equal(result.ok, true);
  result.value.settle({ by: 5 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].ok, true);
});

test('reservation settlement callback faults are attributed without unhandled rejections', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const failures = [];
    const instanceEngine = createEngine({
      requestInstanceFailure: (instanceId, cause) => failures.push([instanceId, cause]),
    });
    const instanceId = await openLiveInstance(instanceEngine);
    const throwing = instanceEngine.reserveAsync({
      issuer: { kind: 'instance', moduleId: 'fixture-module', instanceId },
      causationId: null,
      commandType: 'increment',
      outcomeSchemaId: 'fixture-increment-outcome',
      onCommandSettlement: () => { throw new Error('instance callback fault'); },
    });
    assert.equal(throwing.ok, true);
    throwing.value.settle({ by: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(failures, [[instanceId, 'reservation-settlement-callback-failure']]);
    assert.equal(instanceEngine.phase, 'open');

    const thenableFailures = [];
    const thenableEngine = createEngine({
      requestInstanceFailure: (failedId, cause) => thenableFailures.push([failedId, cause]),
    });
    const thenableInstanceId = await openLiveInstance(thenableEngine);
    const thenable = thenableEngine.reserveAsync({
      issuer: { kind: 'instance', moduleId: 'fixture-module', instanceId: thenableInstanceId },
      causationId: null,
      commandType: 'increment',
      outcomeSchemaId: 'fixture-increment-outcome',
      onCommandSettlement: () => Promise.reject(new Error('async callback forbidden')),
    });
    thenable.value.settle({ by: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(thenableFailures, [[thenableInstanceId, 'reservation-settlement-callback-failure']]);
    assert.equal(thenableEngine.phase, 'open');

    const shellEngine = createEngine();
    await activate(shellEngine);
    const shell = shellEngine.reserveAsync({
      issuer: SHELL_ISSUER,
      causationId: null,
      commandType: 'increment',
      outcomeSchemaId: 'fixture-increment-outcome',
      onCommandSettlement: () => { throw new Error('shell callback fault'); },
    });
    shell.value.settle({ by: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(shellEngine.phase, 'terminal');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
