import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppTextModel } from './local-app-model';
import { createNimiLocalAppAIConsumptionClient, type NimiLocalAppScenarioExecuteShellSpec, type NimiLocalAppScenarioExecuteOptions } from '../app/local-app-runtime-platform-ai';
import type { NimiLocalAppTextTurnInput } from '../app/local-app-text';
import { filePart, textPart } from '../contracts';

function fixture(events: () => AsyncIterable<unknown>, onCancel: () => void = () => {}, executeOutput?: unknown) {
  const inputs: NimiLocalAppTextTurnInput[] = [];
  const executions: { spec: NimiLocalAppScenarioExecuteShellSpec; options?: NimiLocalAppScenarioExecuteOptions }[] = [];
  let canceled = 0;
  const unused = async (): Promise<never> => { throw new Error('unused fixture operation'); };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: async (input) => {
      inputs.push(input);
      return { events: events(), cancel: async () => { canceled++; onCancel(); } };
    } },
    scenario: { execute: executeOutput === undefined ? unused : async (spec, options) => { executions.push({ spec, options }); return executeOutput; } },
    scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: { read: unused, upload: unused },
    voiceAssets: { list: unused, delete: unused },
  });
  return { ai, model: createNimiLocalAppTextModel(ai), inputs, executions, canceled: () => canceled };
}

const user = { role: 'user' as const, content: [{ type: 'text' as const, text: 'Search.' }] };
const tool = { name: 'search', inputSchema: { type: 'object' } };
const call = { id: 'call-1', name: 'search', arguments: { query: 'Nimi', token: 'business data' } };

test('App initiation keeps system and assistant context without inventing a user turn', async () => {
  for (const executionMode of ['stream', 'sync'] as const) {
    const f = fixture(async function* () {
      yield { type: 'delta', sequence: '1', traceId: 'initiation', itemIndex: 0, text: '继续。' };
      yield { type: 'completed', sequence: '2', traceId: 'initiation', finishReason: 'stop' };
    }, undefined, { output: { type: 'text-generate', items: [{ type: 'text', text: '继续。' }], finishReason: 'stop' }, traceId: 'initiation' });
    const model = createNimiLocalAppTextModel(f.ai, { executionMode });
    const system = { role: 'system' as const, content: [textPart('角色和场景规则')] };
    const assistant = { role: 'assistant' as const, content: [], turnItems: [{ type: 'output' as const, output: { type: 'text' as const, text: '  我在邮局等你。\n' } }] };
    for (const messages of [[system], [assistant], [system, assistant]]) await model.generateText({ messages });
    const inputs = executionMode === 'sync' ? f.executions.map(value => value.spec as NimiLocalAppTextTurnInput) : f.inputs;
    assert.deepEqual(inputs.map(input => input.messages.map(message => message.role)), [['system'], ['assistant'], ['system', 'assistant']]);
    assert.equal(inputs[2].messages[1].turnItems?.[0].type, 'output');
    assert.deepEqual(inputs[2].messages[1].turnItems, assistant.turnItems);
    await assert.rejects(model.generateText({ messages: [] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
    await assert.rejects(model.generateText({ messages: [{ role: 'assistant', content: [], turnItems: [{ type: 'output', output: { type: 'reasoning-continuity', carrier: { kind: 'test.encrypted', version: 1, payload: new Uint8Array([1]) } } }] }] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
    assert.equal(executionMode === 'sync' ? f.executions.length : f.inputs.length, 3);
  }
});

test('explicit SYNC uses Scenario execution and preserves ordered tool continuity and request controls', async () => {
  const carrier = { kind: 'test.encrypted', version: 1, payload: [0, 127, 255] };
  const f = fixture(async function* () { throw new Error('SYNC must not open a text stream'); }, undefined, {
    output: { type: 'text-generate', items: [{ type: 'reasoning-continuity', carrier }, { type: 'text', text: 'Searching. ' }, { type: 'tool-call', toolCall: call }], finishReason: 'tool-calls' },
    traceId: 'sync-step',
  });
  const signal = new AbortController().signal;
  const model = createNimiLocalAppTextModel(f.ai, { executionMode: 'sync' });
  const result = await model.generateText({ messages: [user], tools: [tool], toolChoice: 'required', parameters: { maxTokens: 100 }, signal });
  assert.equal(f.inputs.length, 0);
  assert.equal(f.executions.length, 1);
  assert.equal(f.executions[0].spec.type, 'text-generate');
  assert.ok(f.executions[0].options?.signal instanceof AbortSignal);
  assert.equal(f.executions[0].options?.signal?.aborted, false);
  assert.equal((f.executions[0].spec as NimiLocalAppTextTurnInput).maxTokens, 100);
  assert.equal(result.text, 'Searching. ');
  assert.deepEqual(result.toolCalls, [call]);
  assert.deepEqual(result.outputItems?.[0], { type: 'reasoning-continuity', carrier: { ...carrier, payload: new Uint8Array(carrier.payload) } });
  const format = { type: 'json-schema' as const, strict: true, schema: { type: 'object' } };
  await model.generateText({ messages: [user], responseFormat: format });
  assert.deepEqual((f.executions[1].spec as NimiLocalAppTextTurnInput).responseFormat, format);
});

test('SYNC abort settles before a late Scenario result and emits no partial tool batch', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const f = fixture(async function* () { throw new Error('must not fall back to STREAM'); }, undefined, pending);
  const controller = new AbortController();
  const model = createNimiLocalAppTextModel(f.ai, { executionMode: 'sync' });
  const observed: unknown[] = [];
  const drain = (async () => { for await (const event of await model.streamText!({ messages: [user], tools: [tool], signal: controller.signal })) observed.push(event); })();
  await Promise.resolve();
  assert.equal(f.executions.length, 1);
  controller.abort();
  await assert.rejects(drain, { reasonCode: 'OPERATION_ABORTED' });
  assert.equal(f.executions[0].options?.signal?.aborted, true);
  release({ output: { type: 'text-generate', items: [{ type: 'tool-call', toolCall: call }], finishReason: 'tool-calls' }, traceId: 'late-sync' });
  await Promise.resolve();
  assert.deepEqual(observed, []);
  assert.equal(f.inputs.length, 0);
});

test('a SYNC refusal is preserved without retrying a streamed transport', async () => {
  const f = fixture(async function* () { throw new Error('unexpected STREAM'); }, undefined, Promise.reject(Object.assign(new Error('mode refused'), { reasonCode: 'ai-text-behavior-unsupported' })));
  const model = createNimiLocalAppTextModel(f.ai, { executionMode: 'sync' });
  await assert.rejects(model.generateText({ messages: [user] }), { reasonCode: 'ai-text-behavior-unsupported' });
  assert.equal(f.executions.length, 1);
  assert.equal(f.inputs.length, 0);
});

test('Local App owned audio/video references preserve ordered content without inline or URI bypass', async () => {
  for (const mediaType of ['audio/wav', 'audio/mpeg', 'video/mp4']) {
    const f = fixture(async function* () {
      yield { type: 'delta', sequence: '1', traceId: 'owned-media', itemIndex: 0, text: 'Observed.' };
      yield { type: 'completed', sequence: '2', traceId: 'owned-media', finishReason: 'stop' };
    });
    await f.model.generateText({ messages: [{ role: 'user', content: [textPart('Inspect '), { type: 'artifact-ref', artifactId: 'owned-media', mediaType }, textPart(' briefly.')] }] });
    assert.deepEqual(f.inputs[0]?.messages[0]?.parts, [{ type: 'text', text: 'Inspect ' }, { type: 'artifact-ref', artifactId: 'owned-media', mediaType }, { type: 'text', text: ' briefly.' }]);
  }
});

test('Local App model preserves positioned system instructions and keeps the other input bounds', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'positioned-system', itemIndex: 0, text: 'Reply' };
    yield { type: 'completed', sequence: '2', traceId: 'positioned-system', finishReason: 'stop' };
  });
  await f.model.generateText({ messages: [
    { role: 'system', content: [textPart('Character rules')] },
    { role: 'system', content: [textPart('World information')] },
    user,
    { role: 'assistant', content: [], turnItems: [{ type: 'output', output: { type: 'text', text: 'The door opened.' } }] },
    { role: 'system', content: [textPart('  作者注：保持场景。\n')] },
  ] });
  assert.deepEqual(f.inputs[0].messages.map(m => [m.role, m.text]), [
    ['system', 'Character rules'], ['system', 'World information'], ['user', 'Search.'],
    ['assistant', ''], ['system', '  作者注：保持场景。\n'],
  ]);
  await assert.rejects(f.model.generateText({ messages: [{ role: 'system', content: [textPart('   ')] }] }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
  await assert.rejects(f.model.generateText({ messages: Array.from({ length: 129 }, () => user) }), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
  assert.equal(f.inputs.length, 1);
});

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
  const carrier = { kind: 'openai_chatgpt_plan.responses.encrypted-reasoning', version: 1, payload: Array.from(payload) };
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
