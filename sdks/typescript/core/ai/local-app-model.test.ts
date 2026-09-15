import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppTextModel } from './local-app-model';
import { createNimiLocalAppAIConsumptionClient } from '../app/local-app-runtime-platform-ai';
import type { NimiLocalAppTextTurnInput } from '../app/local-app-text';
import { filePart, textPart } from '../contracts';

function fixture(events: () => AsyncIterable<unknown>, onCancel: () => void = () => {}, executeOutput?: unknown) {
  const inputs: NimiLocalAppTextTurnInput[] = [];
  let canceled = 0;
  const unused = async (): Promise<never> => { throw new Error('unused fixture operation'); };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: async (input) => {
      inputs.push(input);
      return { events: events(), cancel: async () => { canceled++; onCancel(); } };
    } },
    scenario: { execute: executeOutput === undefined ? unused : async () => executeOutput },
    scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: { read: unused, upload: unused },
    voiceAssets: { list: unused },
  });
  return { ai, model: createNimiLocalAppTextModel(ai), inputs, canceled: () => canceled };
}

const user = { role: 'user' as const, content: [{ type: 'text' as const, text: 'Search.' }] };
const tool = { name: 'search', inputSchema: { type: 'object' } };
const call = { id: 'call-1', name: 'search', arguments: { query: 'Nimi', token: 'business data' } };

test('Local App image input preserves user part order alongside tools and schema controls', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'image-input', itemIndex: 0, text: '{"valid":true}' };
    yield { type: 'completed', sequence: '2', traceId: 'image-input', finishReason: 'stop' };
  });
  const responseFormat = { type: 'json-schema' as const, schema: { type: 'object', properties: { valid: { type: 'boolean' } }, required: ['valid'], additionalProperties: false } };
  await f.model.generateText({
    messages: [{ role: 'user', content: [
      textPart('Compare '), filePart('image/png', 'https://example.com/first.png'),
      textPart(' with '), { type: 'artifact-ref', artifactId: 'uploaded-second', mediaType: 'image/png', displayName: 'Second diagram' },
    ] }],
    responseFormat,
  });
  assert.deepEqual(f.inputs[0].messages, [{ role: 'user', text: '', parts: [
    { type: 'text', text: 'Compare ' }, { type: 'image-url', url: 'https://example.com/first.png' },
    { type: 'text', text: ' with ' }, { type: 'artifact-ref', artifactId: 'uploaded-second', mediaType: 'image/png', displayName: 'Second diagram' },
  ] }]);
  assert.deepEqual(f.inputs[0].responseFormat, responseFormat);
});

test('Local App image input rejects inline media, non-image files and non-user media before transport', async () => {
  for (const content of [
    [filePart('image/png', 'data:image/png;base64,AAAA')],
    [filePart('image/png', '/tmp/image.png')],
    [filePart('audio/wav', 'https://example.com/audio.wav')],
    [{ type: 'artifact-ref' as const, localArtifactId: 'private-local-id', mediaType: 'image/png' }],
  ]) {
    const f = fixture(async function* () { throw new Error('must not open'); });
    await assert.rejects(f.model.generateText({ messages: [{ role: 'user', content }] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
    assert.equal(f.inputs.length, 0);
  }
  const f = fixture(async function* () { throw new Error('must not open'); });
  await assert.rejects(f.model.generateText({ messages: [{ role: 'system', content: [filePart('image/png', 'https://example.com/image.png')] }] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
  assert.equal(f.inputs.length, 0);
});

test('opaque continuity survives the native JSON boundary and the next model turn', async () => {
  const carrier = { kind: 'test.encrypted', version: 1, payload: [0, 127, 255] };
  const f = fixture(async function* () {
    yield { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-continuity', itemIndex: 0, carrier };
    yield { type: 'tool-call', sequence: '2', traceId: 'trace-continuity', itemIndex: 1, toolCall: call };
    yield { type: 'completed', sequence: '3', traceId: 'trace-continuity', finishReason: 'tool-calls' };
  });
  const first = await f.model.generateText({ messages: [user], tools: [tool] });
  assert.deepEqual(first.outputItems?.[0], { type: 'reasoning-continuity', carrier: { ...carrier, payload: new Uint8Array(carrier.payload) } });
  await f.model.generateText({ messages: [user, { role: 'assistant', content: [], turnItems: [
    ...first.outputItems!.map((output) => ({ type: 'output' as const, output })),
    { type: 'tool-result', toolResult: { toolCallId: call.id, toolName: call.name, result: 'found' } },
  ] }], tools: [tool] });
  assert.deepEqual(f.inputs[1].messages[1].turnItems?.[0], { type: 'output', output: { type: 'reasoning-continuity', carrier } });
});

test('invalid or carrier-only output cannot complete a Local App step', async () => {
  for (const payload of [[1], [], [256], Array(64 * 1024 + 1).fill(1)]) {
    const f = fixture(async function* () {
      yield { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-continuity', itemIndex: 0, carrier: { kind: 'test', version: 1, payload } };
      yield { type: 'completed', sequence: '2', traceId: 'trace-continuity', finishReason: 'stop' };
    });
    await assert.rejects(f.model.generateText({ messages: [user] }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  }
});

test('sync and streamed output preserve native content after JSON representation expands', async () => {
  const payload = new TextEncoder().encode(JSON.stringify({
    type: 'reasoning', id: 'rs_budget', encrypted_content: 'A'.repeat(60 * 1024), summary: [],
  }));
  const carrier = { kind: 'openai_codex.responses.encrypted-reasoning', version: 1, payload: Array.from(payload) };
  // Runtime/native retain this compact numeric spelling. The JSON projection
  // carries the same values, whose JS serialization uses much longer decimals.
  const rawArguments = `{"values":[${Array(16 * 1024).fill('1e20').join(',')}]}`;
  const text = 'x'.repeat(100 * 1024);
  for (const toolCall of [call, { ...call, arguments: JSON.parse(rawArguments) }]) {
    const items = [{ type: 'reasoning-continuity', carrier }, { type: 'tool-call', toolCall }, { type: 'text', text }];
    const f = fixture(async function* () {
      let sequence = 0;
      yield { type: 'reasoning-continuity', sequence: String(++sequence), traceId: 'trace-budget', itemIndex: 0, carrier };
      yield { type: 'tool-call', sequence: String(++sequence), traceId: 'trace-budget', itemIndex: 1, toolCall };
      for (let offset = 0; offset < text.length; offset += 64 * 1024) {
        yield { type: 'delta', sequence: String(++sequence), traceId: 'trace-budget', itemIndex: 2, text: text.slice(offset, offset + 64 * 1024) };
      }
      yield { type: 'completed', sequence: String(++sequence), traceId: 'trace-budget', finishReason: 'tool-calls' };
    }, undefined, { output: { type: 'text-generate', items, finishReason: 'tool-calls' }, traceId: 'trace-budget' });
    const sync = await f.ai.scenario.execute({ type: 'text-generate', messages: [{ role: 'user', text: 'Answer.' }], tools: [tool] });
    assert.equal(sync.output.type, 'text-generate');
    assert.deepEqual(sync.output.type === 'text-generate' && sync.output.items, items);
    const streamed = await f.model.generateText({ messages: [user], tools: [tool] });
    assert.equal(streamed.text, text);
    assert.deepEqual(streamed.toolCalls, [toolCall]);
  }
});

test('sync output rejects an individually oversized text item', async () => {
  const f = fixture(async function* () {}, undefined, { output: {
    type: 'text-generate', items: [{ type: 'text', text: 'x'.repeat(256 * 1024 + 1) }], finishReason: 'stop',
  }, traceId: 'trace-size' });
  await assert.rejects(f.ai.scenario.execute({ type: 'text-generate', messages: [{ role: 'user', text: 'Answer.' }] }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
});

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

test('failed Local App text generation preserves its Runtime trace', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'trace-failed-json', itemIndex: 0, text: '{"partial":' };
    yield { type: 'failed', sequence: '2', traceId: 'trace-failed-json', reasonCode: 'ai-output-invalid', actionHint: 'inspect_reason_code_and_retry_with_corrected_request' };
  });
  await assert.rejects(f.model.generateText({ messages: [user], responseFormat: { type: 'json-object' } }), {
    reasonCode: 'ai-output-invalid', traceId: 'trace-failed-json', retryable: false,
  });
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
