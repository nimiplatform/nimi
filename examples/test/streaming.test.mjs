import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { streamAnswer } from '../sdk/02-streaming.ts';
import { isNimiError } from '@nimiplatform/sdk/types';

function makeClient(open) {
  return { ai: { text: { streamTurn: open } } };
}

test('an already stopped request never dispatches', async () => {
  const reason = new Error('stopped before dispatch');
  let dispatched = false;
  await assert.rejects(streamAnswer(makeClient(async () => {
    dispatched = true;
    throw new Error('must not dispatch');
  }), 'Hello', () => {}, AbortSignal.abort(reason)), error => error === reason);
  assert.equal(dispatched, false);
});

test('stopping during Host establishment cancels the returned stream without consuming it', async () => {
  const controller = new AbortController();
  const reason = new Error('stopped while opening');
  let finishOpening;
  const opening = new Promise(resolve => { finishOpening = resolve; });
  let canceled = 0;
  let consumed = false;
  const output = [];
  const result = streamAnswer(makeClient(() => opening), 'Hello', text => output.push(text), controller.signal);
  controller.abort(reason);
  finishOpening({
    cancel: async () => { canceled++; },
    async *[Symbol.asyncIterator]() {
      consumed = true;
      yield { type: 'delta', text: 'late output' };
      yield { type: 'completed' };
    },
  });
  await assert.rejects(result, error => error === reason);
  assert.equal(canceled, 1);
  assert.equal(consumed, false);
  assert.deepEqual(output, []);
});

test('stopping after a delta rejects buffered completion and cancels once', async () => {
  const controller = new AbortController();
  const reason = new Error('stopped after first delta');
  let canceled = 0;
  const output = [];
  const stream = {
    cancel: async () => { canceled++; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'delta', text: 'partial' };
      yield { type: 'completed' };
    },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', text => {
    output.push(text);
    controller.abort(reason);
  }, controller.signal), error => error === reason);
  assert.deepEqual(output, ['partial']);
  assert.equal(canceled, 1);
});

test('a complete stream returns its text and disposes its abort listener', async () => {
  const controller = new AbortController();
  let canceled = 0;
  const output = [];
  const stream = {
    cancel: async () => { canceled++; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'delta', text: 'Hello' };
      yield { type: 'delta', text: ' world' };
      yield { type: 'completed' };
    },
  };
  assert.equal(await streamAnswer(makeClient(async () => stream), 'Hello', text => output.push(text), controller.signal), 'Hello world');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assert.deepEqual(output, ['Hello', ' world']);
  assert.equal(canceled, 1);
});

test('a failed event preserves its typed details and closes the stream', async () => {
  let canceled = 0;
  const stream = {
    cancel: async () => { canceled++; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'failed', reasonCode: 'AI_CONFIG_NOT_FOUND', actionHint: 'configure capability' };
    },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => {}), error => {
    assert.equal(error.reasonCode, 'AI_CONFIG_NOT_FOUND');
    assert.equal(error.actionHint, 'configure capability');
    return true;
  });
  assert.equal(canceled, 1);
});

test('a stream without terminal evidence does not return partial text as success', async () => {
  let canceled = 0;
  const stream = {
    cancel: async () => { canceled++; },
    async *[Symbol.asyncIterator]() { yield { type: 'delta', text: 'partial' }; },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => {}), /without a completed event/);
  assert.equal(canceled, 1);
});

for (const disposition of ['caller-may-resubmit', 'outcome-uncertain']) {
  test(`failed events retain the ${disposition} recovery decision`, async () => {
    const interruption = { cause: 'runtime-restart', resubmitDisposition: disposition };
    const stream = {
      cancel: async () => {},
      async *[Symbol.asyncIterator]() {
        yield { type: 'failed', reasonCode: 'ai-execution-interrupted', actionHint: 'inspect original work', traceId: 'original-trace', interruption };
      },
    };
    await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => {}), error => {
      assert.ok(isNimiError(error));
      assert.equal(error.traceId, 'original-trace');
      assert.deepEqual(error.interruption, interruption);
      assert.equal(error.retryable, disposition === 'caller-may-resubmit');
      return true;
    });
  });
}

test('failed event metadata remains primary when cleanup also fails', async () => {
  const cleanup = new Error('Host close unavailable');
  const interruption = { cause: 'runtime-restart', resubmitDisposition: 'outcome-uncertain' };
  const stream = {
    cancel: async () => { throw cleanup; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'failed', reasonCode: 'ai-execution-interrupted', actionHint: 'inspect original work', traceId: 'original-trace', interruption };
    },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => {}), error => {
    assert.ok(error instanceof AggregateError);
    assert.ok(isNimiError(error));
    assert.equal(error.reasonCode, 'ai-execution-interrupted');
    assert.equal(error.traceId, 'original-trace');
    assert.deepEqual(error.interruption, interruption);
    assert.equal(error.retryable, false);
    assert.equal(error.cause, error.errors[0]);
    assert.equal(error.errors[1], cleanup);
    return true;
  });
});

test('abort remains the primary cause when cancellation rejects', async () => {
  const controller = new AbortController();
  const reason = new Error('User stopped');
  const cleanup = new Error('Host close unavailable');
  let canceled = 0;
  const stream = {
    cancel: async () => { canceled++; throw cleanup; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'delta', text: 'Partial' };
      yield { type: 'completed' };
    },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => controller.abort(reason), controller.signal), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, reason);
    assert.deepEqual(error.errors, [reason, cleanup]);
    return true;
  });
  assert.equal(canceled, 1);
});

test('a cleanup-only failure is still reported', async () => {
  const cleanup = new Error('Host close unavailable');
  const stream = {
    cancel: async () => { throw cleanup; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'delta', text: 'Complete' };
      yield { type: 'completed' };
    },
  };
  await assert.rejects(streamAnswer(makeClient(async () => stream), 'Hello', () => {}), error => error === cleanup);
});
