import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

const STREAM_METHOD = {
  methodId: 'fixture-stream',
  ownerModuleId: 'fixture-module',
  sourceEventType: 'fixture-module.counter.changed',
  terminalEventType: 'fixture-module.counter.finished',
  itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
  terminalSchema: { kind: 'object', properties: { done: { kind: 'boolean' } } },
};

function createEngine({ withTerminalEvent = false } = {}) {
  const registration = fixtureModule();
  registration.eventSchemas['fixture-module.counter.finished'] = { kind: 'object', properties: { done: { kind: 'boolean' } } };
  const originalReduce = registration.behavior.reduce;
  registration.behavior = {
    ...registration.behavior,
    reduce(state, envelope, context) {
      if (envelope.type === 'finish') {
        return { state, events: [{ type: 'fixture-module.counter.finished', payload: { done: true } }] };
      }
      return originalReduce(state, envelope, context);
    },
  };
  registration.commandSchemas.finish = { kind: 'object', properties: {} };
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, registration);
  engine.registerStreamMethod({
    ...STREAM_METHOD,
    terminalEventType: withTerminalEvent ? STREAM_METHOD.terminalEventType : null,
  });
  return engine;
}

async function activate(engine) {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
}

async function openStream(engine, instanceId = null) {
  const opened = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream',
    ownerInstanceId: instanceId,
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);
  return opened.value.streamId;
}

test('stream IDs allocate at open commit and failed opens allocate nothing', async () => {
  const engine = createEngine();
  await activate(engine);
  const streamId = await openStream(engine);
  assert.match(streamId, /^1:stream:1$/);
  const unsupported = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'no-such-method',
    ownerInstanceId: null,
  }, SHELL_ISSUER);
  assert.equal(unsupported.error?.code, 'SIMULATOR_UNSUPPORTED');
  const second = await openStream(engine);
  assert.match(second, /^1:stream:2$/);
});

test('no item before attachment and activation; second observer rejected', async () => {
  const engine = createEngine();
  await activate(engine);
  const streamId = await openStream(engine);
  const items = [];
  const handle = engine.streamHandle(streamId);
  assert.ok(handle);

  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(items.length, 0);

  assert.deepEqual(handle.attach((item) => items.push(item)), { ok: true, value: { attached: true } });
  assert.deepEqual(handle.attach((item) => items.push(item)), { ok: true, value: { attached: false } });

  // Attached but still paused: items do not flow until the queued activation.
  await engine.acceptCommand('increment', { by: 1 }, SHELL_ISSUER);
  assert.equal(items.length, 0);

  const activated = await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);
  assert.deepEqual(activated.value, { activated: true });
  await engine.acceptCommand('increment', { by: 5 }, SHELL_ISSUER);
  assert.deepEqual(items, [{ value: 7 }]);
});

test('items deliver in event-sequence order and completion settles after prior items', async () => {
  const engine = createEngine({ withTerminalEvent: true });
  await activate(engine);
  const streamId = await openStream(engine);
  const items = [];
  const handle = engine.streamHandle(streamId);
  handle.attach((item) => items.push(item));
  await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);

  await engine.acceptCommand('increment', { by: 3 }, SHELL_ISSUER);
  await engine.acceptCommand('increment', { by: 4 }, SHELL_ISSUER);
  const completion = handle.completion;
  await engine.acceptCommand('finish', {}, SHELL_ISSUER);
  const terminal = await completion;
  assert.deepEqual(items, [{ value: 3 }, { value: 7 }]);
  assert.deepEqual(terminal, { status: 'completed', value: { done: true } });
});

test('first cancellation wins; completion never rejects; later cancels report false', async () => {
  const engine = createEngine();
  await activate(engine);
  const streamId = await openStream(engine);
  const handle = engine.streamHandle(streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);

  const first = await engine.acceptCommand('simulator.stream.cancel', { streamId, reason: 'caller' }, SHELL_ISSUER);
  assert.deepEqual(first.value, { cancelled: true });
  const terminal = await handle.completion;
  assert.deepEqual(terminal, { status: 'cancelled', reason: 'caller' });

  const second = await engine.acceptCommand('simulator.stream.cancel', { streamId, reason: 'caller' }, SHELL_ISSUER);
  assert.deepEqual(second.value, { cancelled: false });
  assert.equal(engine.streamHandle(streamId), null);
});

test('detach performs the same queued cancellation with the detach reason', async () => {
  const engine = createEngine();
  await activate(engine);
  const streamId = await openStream(engine);
  const handle = engine.streamHandle(streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.stream.cancel', { streamId, reason: 'detach' }, SHELL_ISSUER);
  assert.deepEqual(await handle.completion, { status: 'cancelled', reason: 'detach' });
});

test('streams open per epoch and old-epoch handles are dead after reset', async () => {
  const engine = createEngine();
  await activate(engine);
  const streamId = await openStream(engine);
  const handle = engine.streamHandle(streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.reset', {}, { kind: 'scenario', moduleId: null, instanceId: null });
  assert.equal(engine.epoch, 2);
  assert.equal(engine.streamHandle(streamId), null);
  assert.deepEqual(await handle.completion, { status: 'cancelled', reason: 'reset' });
});
