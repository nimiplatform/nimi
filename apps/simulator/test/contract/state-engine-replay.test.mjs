import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { replaySimulatorSession, simulatorReplayRecordDigest } from '../../src/state-engine/replay.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SCENARIO_ISSUER,
  SHELL_ISSUER,
} from './fixtures.mjs';

function registrations() {
  return [fixtureModule()];
}

const STREAM_METHOD = Object.freeze({
  methodId: 'fixture-stream',
  ownerModuleId: 'fixture-module',
  sourceEventType: 'fixture-module/counter-changed',
  terminalEventType: null,
  itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
  terminalSchema: { kind: 'json' },
});

async function activate(engine) {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
}

/**
 * Drives one deterministic reference scenario: commands, random draws, clock
 * jobs, an async reservation settled from a live timer, streams, and a full
 * scenario reset. Returns the replay record.
 */
async function driveReferenceScenario({ settleDelayMs = 0 } = {}) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, registrations()[0]);
  engine.registerStreamMethod(STREAM_METHOD);
  await activate(engine);

  await engine.acceptCommand('increment', { by: 3 }, SHELL_ISSUER);
  await engine.acceptCommand('increment-with-random', { scale: 1000 }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment',
    payload: { by: 10 },
    causationId: null,
    delayMs: 500,
  }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.clock.advanceBy', { deltaMs: 1000 }, SCENARIO_ISSUER);

  // External Promise work with a live, nondeterministic settlement delay:
  // the reservation captures release order before awaiting.
  const reservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(reservation.ok, true);
  await new Promise((resolve) => {
    const timer = settleDelayMs > 0 ? setTimeout(resolve, settleDelayMs) : setImmediate(resolve);
    void timer;
  });
  reservation.value.settle({ by: 100 });

  const opened = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream',
    ownerInstanceId: null,
  }, SHELL_ISSUER);
  const handle = engine.streamHandle(opened.value.streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId: opened.value.streamId }, SHELL_ISSUER);
  await engine.acceptCommand('increment', { by: 1000 }, SHELL_ISSUER);

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  await handle.completion;

  await engine.acceptCommand('increment', { by: 7 }, SHELL_ISSUER);
  return engine.buildReplayRecord();
}

test('replay reproduces the committed digest byte-for-byte across 100 fresh engines', async () => {
  const record = await driveReferenceScenario();
  const digest = simulatorReplayRecordDigest(record);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);

  for (let run = 0; run < 100; run += 1) {
    const outcome = await replaySimulatorSession(record, {
      scenario: fixtureScenario(),
      modules: registrations(),
      streamMethods: [STREAM_METHOD],
    });
    assert.equal(outcome.matches, true, `replay run ${run} diverged`);
    assert.equal(simulatorReplayRecordDigest(outcome.engine.buildReplayRecord()), digest, `record digest drifted at run ${run}`);
  }
}, { timeout: 60000 });

test('replay is invariant to live promise timing of the original run', async () => {
  const delays = [0, 1, 5, 15];
  const digests = [];
  for (const settleDelayMs of delays) {
    const record = await driveReferenceScenario({ settleDelayMs });
    // The recorded inputs (operation order, typed outcomes) are identical;
    // only live settlement wall time differed.
    digests.push(simulatorReplayRecordDigest(record));
    const outcome = await replaySimulatorSession(record, {
      scenario: fixtureScenario(),
      modules: registrations(),
      streamMethods: [STREAM_METHOD],
    });
    assert.equal(outcome.matches, true);
  }
  assert.ok(digests.every((digest) => digest === digests[0]));
}, { timeout: 30000 });

test('a tampered replay expectation fails closed', async () => {
  const record = await driveReferenceScenario();
  const tampered = {
    ...record,
    expected: { ...record.expected, revision: record.expected.revision + 1 },
  };
  const outcome = await replaySimulatorSession(tampered, {
    scenario: fixtureScenario(),
    modules: registrations(),
    streamMethods: [STREAM_METHOD],
  });
  assert.equal(outcome.matches, false);
});

test('replay validates protocol, scenario, ordered modules, and stream inventory before execution', async () => {
  const record = await driveReferenceScenario();
  const invalidRecords = [
    { ...record, protocolRevision: 2 },
    { ...record, scenarioId: 'foreign-scenario' },
    { ...record, scenarioRevision: 'foreign-revision' },
    { ...record, seed: `b${record.seed.slice(1)}` },
    { ...record, initialLogicalTime: record.initialLogicalTime + 1 },
    { ...record, moduleIds: [] },
    { ...record, streamMethods: [] },
  ];
  for (const invalid of invalidRecords) {
    await assert.rejects(() => replaySimulatorSession(invalid, {
      scenario: fixtureScenario(),
      modules: registrations(),
      streamMethods: [STREAM_METHOD],
    }), /SIMULATOR_REPLAY_MISMATCH/u);
  }
});

test('reset reservation cancellation is explicit and allocation tampering fails closed', async () => {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, registrations()[0]);
  await activate(engine);
  const reservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(reservation.ok, true);
  await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  const record = engine.buildReplayRecord();
  const terminal = record.inputs.find((entry) => entry.kind === 'reservation-terminal');
  assert.deepEqual(terminal.reservation, {
    reservationId: '1:async:1',
    epoch: 1,
    allocationSequence: 1,
    resolution: 'cancelled',
    outcome: null,
    cancelReason: 'reset',
  });
  const replayed = await replaySimulatorSession(record, {
    scenario: fixtureScenario(),
    modules: registrations(),
  });
  assert.equal(replayed.matches, true);

  const tampered = {
    ...record,
    inputs: record.inputs.map((entry) => entry.kind === 'reservation-allocate'
      ? {
          ...entry,
          allocation: { ...entry.allocation, allocationSequence: 2, reservationId: '1:async:2' },
        }
      : entry),
  };
  await assert.rejects(() => replaySimulatorSession(tampered, {
    scenario: fixtureScenario(),
    modules: registrations(),
  }), /SIMULATOR_REPLAY_MISMATCH/u);
});

test('operation settlements expose stream divergence even when reset masks the final state digest', async () => {
  const record = await driveReferenceScenario();
  const withoutStreamCatalog = {
    ...record,
    streamMethods: [],
    inputs: record.inputs.filter((entry) => !entry.kind.startsWith('stream-')),
  };
  const outcome = await replaySimulatorSession(withoutStreamCatalog, {
    scenario: fixtureScenario(),
    modules: registrations(),
    streamMethods: [],
  });
  assert.equal(outcome.recomputed.stateDigest, record.expected.stateDigest, 'reset masks the pre-reset stream branch');
  assert.equal(outcome.matches, false, 'typed operation settlements still expose the divergence');
});

test('replay record canonicalization rejects non-JSON values', async () => {
  const { canonicalizeJson, assertJsonValue } = await import('../../src/state-engine/json-value.ts');
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0, undefined, Symbol('x'), 1n]) {
    assert.throws(() => assertJsonValue(bad));
  }
  assert.throws(() => assertJsonValue({ nested: [1, undefined] }));
  const sparse = [1];
  delete sparse[0];
  sparse.length = 2;
  assert.throws(() => assertJsonValue(sparse));
  assert.throws(() => assertJsonValue(Object.create({ inherited: true })));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => assertJsonValue(cyclic));
  assert.throws(() => assertJsonValue('\ud800'));
  assert.throws(() => assertJsonValue({ ['\udc00']: true }));
  assert.throws(() => canonicalizeJson(cyclic));
  assert.equal(canonicalizeJson({ b: 1, a: [true, null] }), '{"a":[true,null],"b":1}');
});
