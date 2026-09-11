import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppTextModel } from './local-app-model';
import { createNimiLocalAppAIConsumptionClient } from '../app/local-app-runtime-platform-ai';
import type { NimiLocalAppTextTurnInput } from '../app/local-app-text';

function fixture(events: () => AsyncIterable<unknown>, onCancel: () => void = () => {}) {
  const inputs: NimiLocalAppTextTurnInput[] = [];
  let canceled = 0;
  const unused = async (): Promise<never> => { throw new Error('unused fixture operation'); };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: async (input) => {
      inputs.push(input);
      return { events: events(), cancel: async () => { canceled++; onCancel(); } };
    } },
    scenario: { execute: unused },
    scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: { read: unused, upload: unused },
    voiceAssets: { list: unused },
  });
  return { ai, model: createNimiLocalAppTextModel(ai), inputs, canceled: () => canceled };
}

const user = { role: 'user' as const, content: [{ type: 'text' as const, text: 'Search.' }] };
const tool = { name: 'search', inputSchema: { type: 'object' } };
const call = { id: 'call-1', name: 'search', arguments: { query: 'Nimi', token: 'business data' } };

test('Local App model preserves common tool values without executing callbacks', async () => {
  const f = fixture(async function* () {
    yield { type: 'tool-call', sequence: '1', traceId: 'trace-1', itemIndex: 0, toolCall: call };
    yield { type: 'completed', sequence: '2', traceId: 'trace-1', finishReason: 'tool-calls' };
  });
  let executions = 0;
  const result = await f.model.generateText({ messages: [user], tools: [{ ...tool, execute: () => { executions++; return null; } }] });
  assert.equal(f.model.model.modelId, 'text.generate');
  assert.deepEqual(result.toolCalls, [call]);
  assert.deepEqual(result.outputItems, [{ type: 'tool-call', toolCall: call }]);
  assert.equal(result.finishReason, 'tool-calls');
  assert.equal(executions, 0);
  assert.deepEqual(f.inputs[0].tools, [{ type: 'function', ...tool }]);
  assert.equal(f.canceled(), 1);
});

test('later explicit ordered results remain paired to the original tool call', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'trace-2', itemIndex: 0, text: 'Answer.' };
    yield { type: 'completed', sequence: '2', traceId: 'trace-2', finishReason: 'stop' };
  });
  const turnItems = [
    { type: 'output' as const, output: { type: 'tool-call' as const, toolCall: call } },
    { type: 'tool-result' as const, toolResult: { toolCallId: call.id, toolName: call.name, result: { items: ['source'] } } },
  ];
  const result = await f.model.generateText({ messages: [user, { role: 'assistant', content: [], turnItems }], tools: [tool], toolChoice: 'none' });
  assert.equal(result.text, 'Answer.');
  assert.deepEqual(f.inputs[0].messages[1].turnItems, turnItems);
  assert.equal(f.inputs[0].toolChoice, 'none');
});

test('structured response constraints reach the formal text carrier', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'trace-json', itemIndex: 0, text: '{"answer":1}' };
    yield { type: 'completed', sequence: '2', traceId: 'trace-json', finishReason: 'stop' };
  });
  const responseFormat = { type: 'json-schema' as const, schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] }, strict: true };
  await f.model.generateText({ messages: [user], responseFormat });
  assert.deepEqual(f.inputs[0].responseFormat, responseFormat);
});

test('abort closes the active carrier and does not return a partial success', async () => {
  const waiting = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'trace-cancel', itemIndex: 0, text: 'Partial' };
    waiting.resolve();
    await closed.promise;
  }, () => closed.resolve());
  const controller = new AbortController();
  const pending = f.model.generateText({ messages: [user], signal: controller.signal });
  await waiting.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.canceled(), 1);
});

for (const scenario of ['sequence', 'terminal'] as const) {
  test(`Local App text stream rejects an invalid ${scenario}`, async () => {
    const f = fixture(async function* () {
      yield { type: 'delta', sequence: '1', traceId: 'trace-invalid', itemIndex: 0, text: 'Partial' };
      if (scenario === 'sequence') yield { type: 'completed', sequence: '3', traceId: 'trace-invalid', finishReason: 'stop' };
    });
    await assert.rejects(f.model.generateText({ messages: [user] }), (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_LOCAL_APP_PROJECTION_INVALID');
      assert.match((error as Error).message, new RegExp(scenario));
      return true;
    });
    assert.equal(f.canceled(), 1);
  });
}

test('unrepresentable provider tools fail before transport', async () => {
  const f = fixture(async function* () { throw new Error('must not open'); });
  await assert.rejects(f.model.generateText({ messages: [user], tools: [{ type: 'provider', id: 'remote-tool', name: 'remote', args: {} }] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
  assert.equal(f.inputs.length, 0);
});
