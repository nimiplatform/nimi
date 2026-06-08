import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNimiCapabilitySupported,
  assertNimiEventOrder,
  assertNimiOutputSchema,
  collectMockModelStream,
  createNimiMockModel,
  createNimiMockRuntime,
  createNimiStreamSimulator,
  createNimiToolCall,
  userTextMessage,
} from '.';

test('mock model generates deterministic text and records request shape through callback', async () => {
  const model = createNimiMockModel({
    onGenerateText(request) {
      assert.equal(request.messages[0]?.role, 'user');
      return { text: 'hello', finishReason: 'stop', usage: { totalTokens: 2 } };
    },
  });

  const result = await model.generateText({
    model: model.model,
    messages: [userTextMessage('say hello')],
  });

  assert.equal(result.text, 'hello');
  assert.equal(result.usage?.totalTokens, 2);
});

test('stream simulator preserves run event ordering and collection semantics', async () => {
  const toolCall = createNimiToolCall('lookup', { query: 'nimi' });
  const events = [
    { type: 'start', traceId: 'trace-1' },
    { type: 'text-delta', text: 'hi' },
    { type: 'tool-call', toolCall },
    { type: 'done', finishReason: 'tool-calls' },
  ] as const;

  assertNimiEventOrder(events, ['start', 'text-delta', 'tool-call', 'done']);

  const streamed = createNimiStreamSimulator(events);
  const seen = [];
  for await (const event of streamed) {
    seen.push(event);
  }
  assert.equal(seen.length, events.length);

  const model = createNimiMockModel({ streamEvents: events });
  const result = await collectMockModelStream(model, {
    model: model.model,
    messages: [userTextMessage('use a tool')],
  });
  assert.equal(result.text, 'hi');
  assert.equal(result.toolCalls?.[0]?.name, 'lookup');
  assert.equal(result.finishReason, 'tool-calls');
});

test('mock runtime records operation calls without reaching Runtime internals', async () => {
  const runtime = createNimiMockRuntime((operation, input) => ({ ok: true, operation, input }));
  const result = await runtime.invoke('RuntimeLocalService.Test', { id: '123' });

  assert.deepEqual(result, { ok: true, operation: 'RuntimeLocalService.Test', input: { id: '123' } });
  assert.deepEqual(runtime.calls, [{ operation: 'RuntimeLocalService.Test', input: { id: '123' } }]);
});

test('schema and capability assertions fail visibly', () => {
  assert.doesNotThrow(() => assertNimiOutputSchema({ answer: 'yes' }, { type: 'object', required: ['answer'] }));
  assert.throws(() => assertNimiOutputSchema({}, { type: 'object', required: ['answer'] }), /missing required output field/);

  const manifest = {
    adapterId: 'unit-test',
    targetLibrary: 'unit',
    capabilityLevel: 'L1',
    capabilities: {
      textGeneration: { support: 'supported', mode: 'adapter-mapped' },
      streaming: { support: 'unsupported', mode: 'adapter-mapped' },
    },
    unsupportedBehavior: 'throw',
  } as const;

  assertNimiCapabilitySupported(manifest, 'textGeneration');
  assert.throws(() => assertNimiCapabilitySupported(manifest, 'streaming'), /expected supported but found unsupported/);
});
