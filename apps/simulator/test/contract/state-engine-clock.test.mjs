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

function createEngine() {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, fixtureModule());
  return engine;
}

async function activate(engine) {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
}

test('logical time advances only through explicit advanceBy/advanceTo', async () => {
  const engine = createEngine();
  await activate(engine);
  assert.equal(engine.getCommitted().logicalTime, 0);

  const advanced = await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1500 }, SCENARIO_ISSUER);
  assert.equal(advanced.ok, true);
  assert.deepEqual(advanced.value, { now: 1500, pendingJobs: 0 });

  const advancedTo = await engine.acceptCommand('simulator.clock.advanceTo', { targetMs: 9000 }, SCENARIO_ISSUER);
  assert.equal(advancedTo.value.now, 9000);

  const backward = await engine.acceptCommand('simulator.clock.advanceTo', { targetMs: 8000 }, SCENARIO_ISSUER);
  assert.equal(backward.ok, false);
  assert.equal(backward.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  assert.equal(engine.getCommitted().logicalTime, 9000);
});

test('clock rejects negative, fractional, and overflowing values', async () => {
  const engine = createEngine();
  await activate(engine);
  for (const deltaMs of [-1, 1.5, Number.POSITIVE_INFINITY]) {
    const result = await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs }, SCENARIO_ISSUER);
    assert.equal(result.ok, false, `deltaMs=${deltaMs}`);
    assert.equal(result.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  }
  // Advancing to exactly Number.MAX_SAFE_INTEGER is legal; past it overflows.
  const exact = await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: Number.MAX_SAFE_INTEGER }, SCENARIO_ISSUER);
  assert.equal(exact.ok, true);
  assert.equal(engine.getCommitted().logicalTime, Number.MAX_SAFE_INTEGER);
  const overflow = await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1 }, SCENARIO_ISSUER);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  assert.equal(engine.getCommitted().logicalTime, Number.MAX_SAFE_INTEGER);
});

test('jobs enqueue commands in due-time then allocation order', async () => {
  const engine = createEngine();
  await activate(engine);
  const first = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 1 },
    causationId: null,
    delayMs: 5000,
  }, SHELL_ISSUER);
  assert.equal(first.ok, true);
  const second = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 10 },
    causationId: null,
    delayMs: 5000,
  }, SHELL_ISSUER);
  assert.equal(second.ok, true);
  const third = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 100 },
    causationId: null,
    delayMs: 1000,
  }, SHELL_ISSUER);
  assert.match(third.value.jobId, /^1:job:3$/);

  // No progress without explicit advancement.
  const idle = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(idle.value.counter, 0);

  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 999 }, SCENARIO_ISSUER);
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 0);

  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1 }, SCENARIO_ISSUER);
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 100);

  // Equal due times order by allocation sequence: first (+1) then second (+10).
  await engine.acceptCommand('simulator.clock.advanceTo', { targetMs: 5000 }, SCENARIO_ISSUER);
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 111);
});

test('job cancellation before and after due', async () => {
  const engine = createEngine();
  await activate(engine);
  const scheduled = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 5 },
    causationId: null,
    delayMs: 100,
  }, SHELL_ISSUER);
  const cancelled = await engine.acceptCommand('simulator.clock.cancelJob', { jobId: scheduled.value.jobId }, SHELL_ISSUER);
  assert.deepEqual(cancelled.value, { cancelled: true });
  const cancelledAgain = await engine.acceptCommand('simulator.clock.cancelJob', { jobId: scheduled.value.jobId }, SHELL_ISSUER);
  assert.deepEqual(cancelledAgain.value, { cancelled: false });

  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1000 }, SCENARIO_ISSUER);
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 0);

  // After queueing, cancellation returns false.
  const second = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 5 },
    causationId: null,
    delayMs: 10,
  }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 10 }, SCENARIO_ISSUER);
  const afterQueue = await engine.acceptCommand('simulator.clock.cancelJob', { jobId: second.value.jobId }, SHELL_ISSUER);
  assert.deepEqual(afterQueue.value, { cancelled: false });
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 5);
});

test('jobs schedule typed commands, never direct mutation', async () => {
  const engine = createEngine();
  await activate(engine);
  const unsupported = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'no-such-command',
    payload: {},
    causationId: null,
    delayMs: 0,
  }, SHELL_ISSUER);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'SIMULATOR_UNSUPPORTED');

  // Zero-delay jobs enqueue within the same drain and commit after the
  // scheduling operation.
  const immediate = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 7 },
    causationId: null,
    delayMs: 0,
  }, SHELL_ISSUER);
  assert.equal(immediate.ok, true);
  assert.equal((await engine.acceptQuery('read-counter', {}, SHELL_ISSUER)).value.counter, 7);
  assert.equal(engine.isQuiescent(), true);
});
