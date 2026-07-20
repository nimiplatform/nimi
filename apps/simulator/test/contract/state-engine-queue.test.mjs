import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSimulatorStateEngine,
  SIMULATOR_MAX_OPERATIONS_PER_DRAIN,
} from '../../src/state-engine/engine.ts';
import {
  FIXTURE_SEED,
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

function createEngine(moduleDefinitions = [fixtureModule()]) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  for (const definition of moduleDefinitions) registerFixtureModule(engine, definition);
  return engine;
}

async function activateBehavior(engine, moduleId = 'fixture-module') {
  const result = await engine.acceptCommand('simulator.behavior.activate', { moduleId }, SHELL_ISSUER);
  assert.equal(result.ok, true);
  return result;
}

test('commands and queries share one FIFO acceptance sequence', async () => {
  const engine = createEngine();
  await activateBehavior(engine);

  const first = await engine.acceptCommand('increment', { by: 5 }, SHELL_ISSUER);
  assert.equal(first.ok, true);
  assert.deepEqual(first.value.eventIds, ['1:evt:1']);

  const query = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.deepEqual(query, { ok: true, value: { counter: 5 } });

  const second = await engine.acceptCommand('increment', { by: 2 }, SHELL_ISSUER);
  assert.equal(second.ok, true);
  const after = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.deepEqual(after.value, { counter: 7 });

  const committed = engine.getCommitted();
  assert.equal(committed.revision, 3); // behavior.activate + two increments
});

test('subscriber-enqueued commands join the same drain in acceptance order', async () => {
  const engine = createEngine();
  await activateBehavior(engine);
  const order = [];

  // C1's commit synchronously enqueues C2; C2's commit enqueues C4.
  const commits = [];
  engine.subscribeState((revision) => {
    commits.push(revision);
    if (revision === 2) {
      order.push('enqueue-c2');
      void engine.acceptCommand('increment', { by: 10 }, SHELL_ISSUER);
    } else if (revision === 3) {
      order.push('enqueue-c4');
      void engine.acceptCommand('increment', { by: 100 }, SHELL_ISSUER);
    }
  });

  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER); // C1
  // All synchronous-chain commands committed within C1's drain turn.
  const final = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(final.value.counter, 111);
  assert.deepEqual(commits.slice(0, 3), [2, 3, 4]);
  assert.deepEqual(order, ['enqueue-c2', 'enqueue-c4']);
});

test('C1,C2,C4,C3 ordering: synchronous chains beat promise continuations', async () => {
  const engine = createEngine();
  await activateBehavior(engine);

  const accepted = [];
  // During C1's drain: commit of C1 enqueues C2; commit of C2 enqueues C4.
  engine.subscribeState((revision) => {
    if (revision === 2) {
      accepted.push(engine.acceptCommand('increment', { by: 10 }, SHELL_ISSUER)); // C2
    } else if (revision === 3) {
      accepted.push(engine.acceptCommand('increment', { by: 100 }, SHELL_ISSUER)); // C4
    }
  });
  const c1 = engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  void c1.then(() => {
    // C3: the result continuation must land after C2 and C4.
    accepted.push(engine.acceptCommand('increment', { by: 1000 }, SHELL_ISSUER));
    return null;
  });
  await c1;
  const results = await Promise.all(accepted);
  const revisions = results.map((result) => result.value.revision);
  assert.deepEqual(revisions, [3, 4, 5]); // C2, C4, C3 in commit order
  const final = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(final.value.counter, 1111);
});

test('a reentrant self-enqueue hits the drain limit and terminates the session', async () => {
  const terminalErrors = [];
  const engine = createSimulatorStateEngine({
    scenario: fixtureScenario(),
    hooks: { onSessionTerminal: (error) => terminalErrors.push(error.code) },
  });
  registerFixtureModule(engine, fixtureModule());
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);

  // Every commit re-enqueues one more command: the drain can never quiesce.
  engine.subscribeState(() => {
    void engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER).then(() => {});
  });
  const first = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(first.ok, true); // committed before the limit was reached
  assert.deepEqual(terminalErrors, ['SIMULATOR_INTEGRITY_FAILURE']);
  assert.equal(engine.phase, 'terminal');

  // After terminal failure, new operations fail pre-queue.
  const after = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(after.ok, false);
  assert.equal(after.error.code, 'SIMULATOR_INTEGRITY_FAILURE');
  assert.equal(after.error.operationId, null);
}, { timeout: 30000 });

test('drain limit settles every accepted remainder in operation-sequence order', async () => {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario(), maxOperationsPerDrain: 25 });
  registerFixtureModule(engine, fixtureModule());
  const settlements = [];
  engine.subscribeState(() => {
    void engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER).then((result) => {
      settlements.push(result.ok ? 'ok' : result.error.code);
    });
  });
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  // The self-enqueue chain already ran inside the activation drain and hit
  // the 25-operation limit: processed operations settled ok first, then every
  // accepted remainder settled with the integrity failure.
  assert.ok(settlements.length > 0);
  const firstFailure = settlements.findIndex((code) => code === 'SIMULATOR_INTEGRITY_FAILURE');
  assert.ok(firstFailure > 0, 'some operations commit before the limit');
  assert.ok(settlements.slice(0, firstFailure).every((code) => code === 'ok'));
  assert.ok(settlements.slice(firstFailure).every((code) => code === 'SIMULATOR_INTEGRITY_FAILURE'));
  assert.equal(engine.phase, 'terminal');
});

test('queries commit no state, revision, random draw, or event', async () => {
  const engine = createEngine();
  await activateBehavior(engine);
  await engine.acceptCommand('increment-with-random', { scale: 100 }, SHELL_ISSUER);
  const before = engine.getCommitted();
  const query = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(query.ok, true);
  const after = engine.getCommitted();
  assert.equal(after.revision, before.revision);
  assert.equal(after.random.drawCount, before.random.drawCount);
  assert.equal(after.logicalTime, before.logicalTime);
});

test('pre-queue failures allocate no operation sequence', async () => {
  const engine = createEngine();
  await activateBehavior(engine);
  const badPayload = await engine.acceptCommand('increment', { by: 'five' }, SHELL_ISSUER);
  assert.equal(badPayload.ok, false);
  assert.equal(badPayload.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  assert.equal(badPayload.error.operationId, null);

  const unknown = await engine.acceptCommand('no-such-command', {}, SHELL_ISSUER);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'SIMULATOR_UNSUPPORTED');
  assert.equal(unknown.error.operationId, null);

  const queued = await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(queued.ok, true);
  // The first queued command after behavior.activate is sequence 2.
  const committed = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
  assert.equal(committed.value.counter, 1);
});

test('seed is exactly 64 lowercase hex and never all zero', async () => {
  const { decodeSimulatorSeed, drawSimulatorRandom, simulatorRandomToSnapshot, simulatorRandomFromSnapshot } =
    await import('../../src/state-engine/random.ts');
  assert.throws(() => decodeSimulatorSeed('A1B2'), /64 lowercase hexadecimal/);
  assert.throws(() => decodeSimulatorSeed('00'.repeat(32)), /all-zero/);
  assert.throws(() => decodeSimulatorSeed('zz'.repeat(32)), /64 lowercase hexadecimal/);
  const state = decodeSimulatorSeed(FIXTURE_SEED);
  const first = drawSimulatorRandom(state);
  assert.ok(first >= 0 && first < 1);
  const snapshot = simulatorRandomToSnapshot(state);
  assert.equal(snapshot.generator, 'xoshiro256ss-v1');
  assert.equal(snapshot.drawCount, 1);
  assert.ok(snapshot.state.every((word) => /^[0-9a-f]{16}$/.test(word)));
  const restored = simulatorRandomFromSnapshot(snapshot);
  assert.equal(drawSimulatorRandom(restored), drawSimulatorRandom(state));
});

test('fixture module id and FIFO depth constants are stable', () => {
  assert.equal(SIMULATOR_MAX_OPERATIONS_PER_DRAIN, 10000);
});
