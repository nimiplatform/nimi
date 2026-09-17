import assert from 'node:assert/strict';
import test from 'node:test';

import { createReadinessBarrier } from '../../src/lifecycle/readiness.ts';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

async function createEngine({ prepared = true } = {}) {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, fixtureModule());
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  if (prepared) {
    await engine.acceptCommand('simulator.instance.transition', {
      instanceId: '1:instance:1',
      transition: 'module_loaded',
    }, SHELL_ISSUER);
    await engine.acceptCommand('simulator.instance.transition', {
      instanceId: '1:instance:1',
      transition: 'prepare_success',
    }, SHELL_ISSUER);
  }
  return engine;
}

function barrierFor(engine) {
  return createReadinessBarrier({
    engine,
    instanceId: '1:instance:1',
    surfaceId: 'main',
    epoch: engine.epoch,
  });
}

test('a mounted App ready signal becomes one ordered State Engine transition', async () => {
  const engine = await createEngine();
  const barrier = barrierFor(engine);

  assert.deepEqual(barrier.signalCandidate(), { ok: true, value: { signaled: true } });
  assert.match(barrier.readinessId, /^1:ready:1$/u);
  assert.deepEqual(await barrier.completion, {
    state: 'usable',
    reason: 'ready',
    markedAtLogicalTime: 0,
  });
  assert.equal(barrier.state, 'usable');
  assert.deepEqual(engine.getCommitted().partitions.shell.readiness['1:ready:1'], {
    instanceId: '1:instance:1',
    markedAtLogicalTime: 0,
    reason: 'ready',
    state: 'usable',
    surfaceId: 'main',
  });
});

test('a loading instance cannot report ready', async () => {
  const engine = await createEngine({ prepared: false });
  const barrier = barrierFor(engine);
  const result = barrier.signalCandidate();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  assert.equal(barrier.state, 'idle');
});

test('a surface can report ready only once', async () => {
  const engine = await createEngine();
  const barrier = barrierFor(engine);
  assert.equal(barrier.signalCandidate().ok, true);
  const repeated = barrier.signalCandidate();
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  await barrier.completion;
  assert.deepEqual(Object.keys(engine.getCommitted().partitions.shell.readiness), ['1:ready:1']);
});

test('reset cancellation becomes observable only when the reset barrier settles it', async () => {
  const engine = await createEngine();
  const barrier = barrierFor(engine);
  const reset = barrier.beginResetCancellation();
  assert.ok(reset);
  assert.equal(barrier.state, 'cancelled');

  let observed = false;
  void barrier.completion.then(() => { observed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed, false);

  reset.settle();
  assert.deepEqual(await barrier.completion, {
    state: 'cancelled',
    reason: 'reset',
    markedAtLogicalTime: null,
  });
});
