import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { createReadinessBarrier } from '../../src/lifecycle/readiness.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

const DECLARATION = {
  contractId: 'fixture-readiness-v1',
  surfaceId: 'main',
  rootContentSemanticId: 'fixture-root',
  primaryControl: {
    semanticId: 'fixture-primary-action',
    ariaRole: 'button',
    accessibleName: 'Run fixture',
  },
};

function expectation(overrides = {}) {
  return {
    contractId: DECLARATION.contractId,
    rootContentSemanticId: DECLARATION.rootContentSemanticId,
    primaryControl: { ...DECLARATION.primaryControl },
    projectionPredicateId: 'fixture-projection-ready',
    blockingStatePredicateId: 'fixture-no-blocking-lease',
    ...overrides,
  };
}

function browserPort(overrides = {}) {
  let frame = 0;
  return {
    currentCommitToken: () => 1,
    awaitCommit: async ({ sinceToken }) => sinceToken + 1,
    nextAnimationFrame: async () => { frame += 1; return frame; },
    checkSemanticMarkers: async () => ({ ok: true }),
    ...overrides,
  };
}

async function createEngine() {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, fixtureModule());
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.instance.transition', {
    instanceId: '1:instance:1', transition: 'module_loaded',
  }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.instance.transition', {
    instanceId: '1:instance:1', transition: 'prepare_success',
  }, SHELL_ISSUER);
  return engine;
}

function createBarrier(engine, overrides = {}) {
  return createReadinessBarrier({
    engine,
    instanceId: '1:instance:1',
    surfaceId: 'main',
    epoch: 1,
    declaration: DECLARATION,
    expectation: expectation(),
    browser: browserPort(overrides.browser),
    projectionPredicate: overrides.projectionPredicate ?? (() => true),
    blockingPredicate: overrides.blockingPredicate ?? (() => false),
    projection: overrides.projection ?? (() => ({})),
    simulationDisclosureVisible: overrides.simulationDisclosureVisible ?? (() => true),
  });
}

test('full barrier: candidate, quiescence, commit, two frames, semantic markers, usable', async () => {
  const engine = await createEngine();
  const order = [];
  const barrier = createBarrier(engine, {
    browser: {
      awaitCommit: async ({ sinceToken }) => {
        order.push('commit');
        return sinceToken + 1;
      },
      nextAnimationFrame: async () => {
        const id = order.filter((entry) => entry.startsWith('frame')).length + 1;
        order.push(`frame:${id}`);
        return id;
      },
      checkSemanticMarkers: async () => {
        order.push('markers');
        return { ok: true };
      },
    },
    projectionPredicate: () => { order.push('projection'); return true; },
    blockingPredicate: () => { order.push('blocking'); return false; },
    simulationDisclosureVisible: () => { order.push('disclosure'); return true; },
  });
  const signaled = barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(signaled, { ok: true, value: { signaled: true } });
  assert.match(barrier.readinessId, /^1:ready:1$/);

  const terminal = await barrier.completion;
  assert.deepEqual(terminal, {
    state: 'usable',
    reason: 'qualified',
    markedAtLogicalTime: 0,
  });
  assert.deepEqual(order, [
    'commit',
    'frame:1',
    'frame:2',
    'projection',
    'blocking',
    'disclosure',
    'markers',
  ]);
  assert.equal(barrier.state, 'usable');

  // The terminal transition committed through the preallocated reservation.
  const shell = engine.getCommitted().partitions.shell;
  assert.equal(shell.readiness['1:ready:1'].state, 'usable');
  assert.equal(shell.readiness['1:ready:1'].reason, 'qualified');
});

test('candidate binds the pre-signal commit floor before asynchronous quiescence work', async () => {
  const engine = await createEngine();
  let commitToken = 7;
  let observedFloor = null;
  const barrier = createBarrier(engine, {
    browser: {
      currentCommitToken: () => commitToken,
      awaitCommit: async ({ instanceId, surfaceId, sinceToken }) => {
        assert.equal(instanceId, '1:instance:1');
        assert.equal(surfaceId, 'main');
        observedFloor = sinceToken;
        return sinceToken + 1;
      },
    },
  });

  assert.deepEqual(
    barrier.signalCandidate({ contractId: DECLARATION.contractId }),
    { ok: true, value: { signaled: true } },
  );
  commitToken = 99;
  assert.equal((await barrier.completion).state, 'usable');
  assert.equal(observedFloor, 7);
});

test('completion remains pending until its ordered State Engine publication commits', async () => {
  const engine = await createEngine();
  const head = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-increment-outcome',
  });
  assert.equal(head.ok, true);
  const barrier = createBarrier(engine);
  barrier.signalCandidate({ contractId: DECLARATION.contractId });

  let observed = null;
  void barrier.completion.then((terminal) => { observed = terminal; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed, null);
  assert.equal(engine.getCommitted().partitions.shell.readiness?.['1:ready:1'], undefined);

  head.value.cancel('caller');
  const terminal = await barrier.completion;
  assert.equal(terminal.state, 'usable');
  assert.equal(engine.getCommitted().partitions.shell.readiness['1:ready:1'].state, 'usable');
});

test('a loading instance cannot signal or become ready', async () => {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, fixtureModule());
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  const barrier = createBarrier(engine);
  const signaled = barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.equal(signaled.ok, false);
  assert.equal(signaled.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  assert.equal(barrier.state, 'idle');
});

test('repeated or mismatched signals fail without creating reservations', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine);
  const wrong = barrier.signalCandidate({ contractId: 'other-contract' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  assert.equal(barrier.readinessId, null);

  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  const repeated = barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  await barrier.completion;
  const readinessEntries = Object.keys(engine.getCommitted().partitions.shell.readiness ?? {});
  assert.deepEqual(readinessEntries, ['1:ready:1']);
});

test('close cancels exactly once and never becomes ready from late callbacks', async () => {
  const engine = await createEngine();
  let commitResolve;
  const barrier = createBarrier(engine, {
    browser: {
      awaitCommit: () => new Promise((resolve) => { commitResolve = resolve; }),
    },
  });
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  barrier.cancel('dispose');
  const terminal = await barrier.completion;
  assert.deepEqual(terminal, { state: 'cancelled', reason: 'dispose', markedAtLogicalTime: null });
  barrier.cancel('dispose');
  // Late browser callbacks cannot revive the barrier.
  commitResolve(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(barrier.state, 'cancelled');
  const readiness = engine.getCommitted().partitions.shell.readiness ?? {};
  assert.equal(Object.keys(readiness).length, 0);
});

test('a new state commit during the barrier cancels it', async () => {
  const engine = await createEngine();
  let commitResolve;
  const barrier = createBarrier(engine, {
    browser: {
      awaitCommit: () => new Promise((resolve) => { commitResolve = resolve; }),
    },
  });
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  await new Promise((resolve) => setImmediate(resolve));
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  const terminal = await barrier.completion;
  assert.deepEqual(terminal, { state: 'cancelled', reason: 'state-change', markedAtLogicalTime: null });
  commitResolve(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(barrier.state, 'cancelled');
});

test('stale epoch cancels the barrier and old signals are rejected', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine);
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  barrier.cancel('stale-epoch');
  assert.deepEqual(await barrier.completion, { state: 'cancelled', reason: 'stale-epoch', markedAtLogicalTime: null });
  const late = barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.equal(late.ok, false);
});

test('reset cancels the barrier through the same one-shot path', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine);
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  barrier.cancel('reset');
  assert.deepEqual(await barrier.completion, { state: 'cancelled', reason: 'reset', markedAtLogicalTime: null });
});

test('reset invalidates immediately but exposes completion only when ordered settlement runs', async () => {
  const engine = await createEngine();
  let commitResolve;
  const barrier = createBarrier(engine, {
    browser: {
      awaitCommit: () => new Promise((resolve) => { commitResolve = resolve; }),
    },
  });
  barrier.signalCandidate({ contractId: DECLARATION.contractId });

  let terminal = null;
  void barrier.completion.then((result) => { terminal = result; });
  const deferred = barrier.beginResetCancellation();
  assert.ok(deferred);
  assert.equal(barrier.state, 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminal, null);

  deferred.settle();
  deferred.settle();
  assert.deepEqual(await barrier.completion, {
    state: 'cancelled', reason: 'reset', markedAtLogicalTime: null,
  });
  commitResolve(2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(barrier.state, 'cancelled');
});

test('semantic mismatch or hidden disclosure fails, never silently ready', async () => {
  const engine = await createEngine();
  const hidden = createBarrier(engine, { simulationDisclosureVisible: () => false });
  hidden.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await hidden.completion, { state: 'failed', reason: 'semantic-mismatch', markedAtLogicalTime: null });

  const markersFail = createBarrier(engine, {
    browser: { checkSemanticMarkers: async () => ({ ok: false }) },
  });
  markersFail.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await markersFail.completion, { state: 'failed', reason: 'semantic-mismatch', markedAtLogicalTime: null });

  const blocked = createBarrier(engine, { blockingPredicate: () => true });
  blocked.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await blocked.completion, { state: 'failed', reason: 'semantic-mismatch', markedAtLogicalTime: null });
});

test('projection predicate failure is a semantic mismatch', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine, { projectionPredicate: () => false });
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await barrier.completion, { state: 'failed', reason: 'semantic-mismatch', markedAtLogicalTime: null });
});

test('render barrier failure is terminal', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine, {
    browser: { nextAnimationFrame: async () => { throw new Error('render unavailable'); } },
  });
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await barrier.completion, { state: 'failed', reason: 'render-barrier-failed', markedAtLogicalTime: null });
  const shell = engine.getCommitted().partitions.shell;
  assert.equal(shell.readiness['1:ready:1'].reason, 'render-barrier-failed');
});

test('browser observation rejection and non-successive frame tokens fail closed without hanging', async () => {
  const engine = await createEngine();
  const rejected = createBarrier(engine, {
    browser: { checkSemanticMarkers: async () => { throw new Error('browser observation unavailable'); } },
  });
  rejected.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await rejected.completion, {
    state: 'failed', reason: 'semantic-mismatch', markedAtLogicalTime: null,
  });

  const secondEngine = await createEngine();
  const duplicateFrames = createBarrier(secondEngine, {
    browser: { nextAnimationFrame: async () => 1 },
  });
  duplicateFrames.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual(await duplicateFrames.completion, {
    state: 'failed', reason: 'render-barrier-failed', markedAtLogicalTime: null,
  });
});

test('declaration and expectation must match exactly at signal acceptance', async () => {
  const engine = await createEngine();
  const barrier = createReadinessBarrier({
    engine,
    instanceId: '1:instance:1',
    surfaceId: 'main',
    epoch: 1,
    declaration: DECLARATION,
    expectation: expectation({ rootContentSemanticId: 'drifted-root' }),
    browser: browserPort(),
    projectionPredicate: () => true,
    blockingPredicate: () => false,
    projection: () => ({}),
    simulationDisclosureVisible: () => true,
  });
  const signaled = barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.equal(signaled.ok, false);
  assert.equal(signaled.error.code, 'SIMULATOR_INVALID_PAYLOAD');
});

test('skeleton surface cannot become ready: candidate is a typed contract gate', async () => {
  const engine = await createEngine();
  const barrier = createBarrier(engine);
  // No declaration contract exists for a loading skeleton: signalCandidate
  // with any non-declared contract ID is rejected synchronously.
  const skeleton = barrier.signalCandidate({ contractId: 'skeleton-placeholder' });
  assert.equal(skeleton.ok, false);
  assert.equal(barrier.state, 'idle');
  // A real candidate still completes the full barrier afterwards.
  barrier.signalCandidate({ contractId: DECLARATION.contractId });
  assert.deepEqual((await barrier.completion).state, 'usable');
});
