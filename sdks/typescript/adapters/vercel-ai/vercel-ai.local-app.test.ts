import assert from 'node:assert/strict';
import test from 'node:test';
import { convertToModelMessages, generateText, readUIMessageStream, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod/v4';
import { createNimiLocalAppAIConsumptionClient, type NimiLocalAppTextTurnInput } from '@nimiplatform/sdk/app';
import { createNimiLocalAppVercelLanguageModel } from './index';

const schema = z.object({ query: z.string() });
const carrier = { kind: 'test.continuity', version: 1, payload: [0, 127, 255] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(events: (step: number) => AsyncIterable<unknown>) {
  const inputs: NimiLocalAppTextTurnInput[] = [];
  const uploads: unknown[] = [];
  const unused = async (): Promise<never> => { throw new Error('unused operation'); };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: async (input) => { inputs.push(input); return { events: events(inputs.length), cancel: async () => {} }; } },
    scenario: { execute: unused }, scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: {
      read: unused,
      upload: async (input) => {
        // The adapter uploads inline image bytes; a source upload is a failure here.
        if (!input.bytes) throw new Error('expected an inline byte upload');
        uploads.push(input);
        return { artifactId: `uploaded-${uploads.length}`, mimeType: input.mimeType, sizeBytes: input.bytes.length };
      },
    },
    voiceAssets: { list: unused, delete: unused },
  });
  return { model: createNimiLocalAppVercelLanguageModel({ ai }), inputs, uploads };
}

async function* toolThenText(step: number) {
  if (step === 1) {
    yield { type: 'reasoning-continuity', sequence: '1', traceId: 'trace', itemIndex: 0, carrier };
    yield { type: 'tool-call', sequence: '2', traceId: 'trace', itemIndex: 1, toolCall: { id: 'lookup-1', name: 'lookup', arguments: { query: 'diagram' } } };
    yield { type: 'completed', sequence: '3', traceId: 'trace', finishReason: 'tool-calls' };
  } else {
    yield { type: 'delta', sequence: '1', traceId: 'trace', itemIndex: 0, text: 'Done.' };
    yield { type: 'completed', sequence: '2', traceId: 'trace', finishReason: 'stop' };
  }
}

test('real Vercel generateText tool loop preserves Local App continuity and result association', async () => {
  const f = fixture(toolThenText);
  const result = await generateText({ model: f.model, prompt: 'Draw.', tools: { lookup: tool({ inputSchema: schema, execute: async () => 'shape documentation' }) }, stopWhen: stepCountIs(2) });
  assert.equal(result.text, 'Done.');
  assert.equal(f.inputs.length, 2);
  assert.deepEqual(f.inputs[1].messages[1].turnItems?.[0], { type: 'output', output: { type: 'reasoning-continuity', carrier } });
  assert.equal(f.inputs[1].messages[2].turnItems?.[0].type, 'tool-result');
});

test('explicit SYNC Vercel tool steps wait for complete Scenario output and replay its continuity', async () => {
  const entered = deferred();
  const release = deferred();
  const inputs: NimiLocalAppTextTurnInput[] = [];
  let executed = 0;
  const unused = async (): Promise<never> => { throw new Error('unexpected operation'); };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: unused },
    scenario: { execute: async (spec) => {
      assert.equal(spec.type, 'text-generate');
      inputs.push(spec as NimiLocalAppTextTurnInput);
      if (inputs.length === 1) {
        entered.resolve();
        await release.promise;
        return { output: { type: 'text-generate', items: [
          { type: 'reasoning-continuity', carrier },
          { type: 'tool-call', toolCall: { id: 'lookup-1', name: 'lookup', arguments: { query: 'diagram' } } },
        ], finishReason: 'tool-calls' }, traceId: 'sync-tool' };
      }
      return { output: { type: 'text-generate', items: [{ type: 'text', text: 'Done.' }], finishReason: 'stop' }, traceId: 'sync-final' };
    } },
    scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: { read: unused, upload: unused },
    voiceAssets: { list: unused, delete: unused },
  });
  const model = createNimiLocalAppVercelLanguageModel({ ai, executionMode: 'sync' });
  const pending = generateText({ model, prompt: 'Draw.', tools: { lookup: tool({ inputSchema: schema, execute: async () => { executed++; return 'shapes'; } }) }, stopWhen: stepCountIs(2) });
  await entered.promise;
  assert.equal(executed, 0);
  release.resolve();
  const result = await pending;
  assert.equal(result.text, 'Done.');
  assert.equal(executed, 1);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[1].messages[1].turnItems?.[0], { type: 'output', output: { type: 'reasoning-continuity', carrier } });
  assert.equal(inputs[1].messages[2].turnItems?.[0].type, 'tool-result');
});

test('UI message JSON storage and convertToModelMessages retain opaque continuity', async () => {
  const f = fixture(toolThenText);
  const result = streamText({ model: f.model, prompt: 'Draw.', tools: { lookup: tool({ inputSchema: schema, execute: async () => 'shapes' }) }, stopWhen: stepCountIs(1) });
  let final;
  for await (const message of readUIMessageStream({ stream: result.toUIMessageStream() })) final = message;
  assert.ok(final);
  const restored = JSON.parse(JSON.stringify(final));
  assert.ok(restored.parts.some((part: { callProviderMetadata?: unknown }) => part.callProviderMetadata));
  const messages = await convertToModelMessages([{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Draw.' }] }, restored]);
  await generateText({ model: f.model, messages, tools: { lookup: tool({ inputSchema: schema }) } });
  assert.deepEqual(f.inputs[1].messages[1].turnItems?.[0], { type: 'output', output: { type: 'reasoning-continuity', carrier } });
  assert.doesNotMatch(restored.parts.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join(''), /AH\/\//);
});

test('framework tool callbacks wait for successful Nimi terminal evidence', async () => {
  const entered = deferred();
  const release = deferred();
  let executed = 0;
  const f = fixture(async function* () {
    yield { type: 'tool-call', sequence: '1', traceId: 'trace', itemIndex: 0, toolCall: { id: 'lookup-1', name: 'lookup', arguments: { query: 'diagram' } } };
    entered.resolve();
    await release.promise;
    throw new Error('model failed before terminal');
  });
  const result = streamText({ model: f.model, prompt: 'Draw.', maxRetries: 0, tools: { lookup: tool({ inputSchema: schema, execute: async () => { executed++; return 'shapes'; } }) } });
  const drain = (async () => { for await (const _ of result.fullStream) { /* consume errors as framework events */ } })();
  const failed = assert.rejects(drain, /model failed before terminal/);
  await entered.promise;
  assert.equal(executed, 0);
  release.resolve();
  await failed;
  assert.equal(executed, 0);
});

test('Vercel binary images use the existing protected App upload before text generation', async () => {
  const f = fixture(async function* () {
    yield { type: 'delta', sequence: '1', traceId: 'trace', itemIndex: 0, text: 'Image received.' };
    yield { type: 'completed', sequence: '2', traceId: 'trace', finishReason: 'stop' };
  });
  await generateText({ model: f.model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect.' }, { type: 'image', image: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' }] }] });
  assert.equal(f.uploads.length, 1);
  assert.deepEqual(f.inputs[0].messages[0].parts?.[1], { type: 'artifact-ref', artifactId: 'uploaded-1', mediaType: 'image/png' });
});
