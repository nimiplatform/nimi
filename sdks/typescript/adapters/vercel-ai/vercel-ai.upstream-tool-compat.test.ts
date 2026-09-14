import assert from 'node:assert/strict';
import test from 'node:test';

import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai';
import { convertReadableStreamToArray } from 'ai/test';
import { z } from 'zod/v4';

import type { NimiAiModel } from '@nimiplatform/sdk/ai';
import type { NimiRunEvent } from '@nimiplatform/sdk/contracts';
import { createNimiVercelLanguageModel } from './index';
import { createUpstreamCompatModel, DEFAULT_USAGE } from './vercel-ai.upstream-compat.fixture';

test('upstream-compat/generateText: provider-executed calls fail without executing caller tools', async () => {
  const { model } = createUpstreamCompatModel({ toolCalls: [{ id: 'provider-call', name: 'lookup', arguments: { query: 'nimi' }, providerExecuted: true }], finishReason: 'tool-calls' });
  let executed = false;
  await assert.rejects(generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'lookup', tools: { lookup: tool({ inputSchema: z.object({ query: z.string() }), execute: async () => { executed = true; return 'bad'; } }) } }), /not admitted/);
  assert.equal(executed, false);
});

test('upstream-compat/generateText: provider-defined tools are rejected by the adapter', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: 'ok' });
  await assert.rejects(generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'lookup', tools: { web: { type: 'provider', id: 'test.web', args: {}, inputSchema: jsonSchema({ type: 'object' }) } } }), /tools.provider/);
  assert.equal(calls.length, 0);
});

test('upstream-compat/generateText: provider tool results are not reported as supported output', async () => {
  const { model } = createUpstreamCompatModel({ content: [{ type: 'text', text: 'ok' }, { type: 'tool-result', toolResult: { toolCallId: 'p1', toolName: 'web', result: { value: true } } }] });
  await assert.rejects(generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'lookup' }), /not admitted/);
});

test('upstream-compat/generateText: invalid caller tool input becomes a framework tool-error', async () => {
  const { model } = createUpstreamCompatModel({
    toolCalls: [{ id: 'invalid-call', name: 'lookup', arguments: { query: 123 } }],
    finishReason: 'tool-calls',
  });
  let executed = false;

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'invalid tool input',
    tools: {
      lookup: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async () => {
          executed = true;
          return 'should not execute';
        },
      }),
    },
  });

  const toolError = result.content.find((part) => part.type === 'tool-error');
  assert.equal(executed, false);
  assert.equal(toolError?.type, 'tool-error');
  assert.equal(toolError?.toolCallId, 'invalid-call');
  assert.equal(result.toolResults.length, 0);
});

test('upstream-compat/generateText: thrown caller tool execution is serialized as tool-error', async () => {
  const { model } = createUpstreamCompatModel({
    toolCalls: [{ id: 'throw-call', name: 'lookup', arguments: { query: 'nimi' } }],
    finishReason: 'tool-calls',
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'throwing tool',
    tools: {
      lookup: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async (): Promise<string> => {
          throw new Error('lookup failed');
        },
      }),
    },
  });

  const toolError = result.content.find((part) => part.type === 'tool-error');
  assert.equal(toolError?.type, 'tool-error');
  assert.equal(toolError?.toolCallId, 'throw-call');
  assert.match(String(toolError?.error), /lookup failed/);
  assert.equal(result.response.messages[0]?.role, 'assistant');
  assert.equal(result.response.messages[1]?.role, 'tool');
});

test('upstream-compat/streamText: unadmitted provider output fails the framework stream', async () => {
  const { model } = createUpstreamCompatModel({ events: [
    { type: 'tool-result', toolResult: { toolCallId: 'p1', toolName: 'web', result: true } },
    { type: 'done', finishReason: 'stop' },
  ] });
  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'lookup' });
  await assert.rejects(async () => { for await (const _ of result.fullStream) {} }, /cannot expose tool-result/);
});

test('upstream-compat/streamText: async iterable caller tools surface preliminary and final results', async () => {
  const { model } = createUpstreamCompatModel({
    toolCalls: [{ id: 'stream-tool-call', name: 'lookup', arguments: { query: 'nimi' } }],
    finishReason: 'tool-calls',
  });

  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'stream caller tool',
    tools: {
      lookup: tool({
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        async *execute({ query }) {
          yield `preview:${query}`;
          yield `final:${query}`;
        },
      }),
    },
  });

  const fullParts = [];
  for await (const part of result.fullStream) {
    fullParts.push(part);
  }

  const toolResults = fullParts.filter((part) => part.type === 'tool-result');
  assert.ok(toolResults.some((part) => part.preliminary === true && part.output === 'preview:nimi'));
  assert.ok(toolResults.some((part) => part.output === 'final:nimi'));
});

test('upstream-compat/generateText: rejects provider approval response approved=true', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: 'unused' });
  const adapter = createNimiVercelLanguageModel({ model });
  await assert.rejects(adapter.doGenerate({ prompt: [{ role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'p1', approved: true }] }] }), /tool-approval-response/);
  assert.equal(calls.length, 0);
});

test('upstream-compat/generateText: rejects provider approval response approved=false', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: 'unused' });
  const adapter = createNimiVercelLanguageModel({ model });
  await assert.rejects(adapter.doGenerate({ prompt: [{ role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'p1', approved: false }] }] }), /tool-approval-response/);
  assert.equal(calls.length, 0);
});

test('upstream-compat/generateText: async iterable tool execute preserves final tool result', async () => {
  const { model } = createUpstreamCompatModel({
    toolCalls: [{ id: 'tool-call', name: 'lookup', arguments: { query: 'nimi' } }],
    finishReason: 'tool-calls',
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'lookup',
    tools: {
      lookup: tool({
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        async *execute({ query }) {
          yield `preview:${query}`;
          yield `final:${query}`;
        },
      }),
    },
  });

  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.preliminary, undefined);
  assert.equal(result.toolResults[0]?.output, 'final:nimi');
});

test('upstream-compat/generateText: multi-step callbacks and total usage follow Vercel aggregation', async () => {
  const { model } = createUpstreamCompatModel([
    {
      toolCalls: [{ id: 'lookup-call', name: 'lookup', arguments: { query: 'nimi' } }],
      finishReason: 'tool-calls',
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    },
    {
      text: 'final answer',
      finishReason: 'stop',
      usage: { promptTokens: 7, completionTokens: 11, totalTokens: 18 },
    },
  ]);
  const stepFinishes: Array<{ text: string; finishReason: string; totalTokens: number }> = [];
  let finishText = '';
  let finishTotalTokens = 0;

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'lookup',
    stopWhen: stepCountIs(3),
    tools: {
      lookup: tool({
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        execute: async ({ query }) => `result:${query}`,
      }),
    },
    onStepFinish(step) {
      stepFinishes.push({
        text: step.text,
        finishReason: step.finishReason,
        totalTokens: step.usage.totalTokens ?? 0,
      });
    },
    onFinish(finish) {
      finishText = finish.text;
      finishTotalTokens = finish.totalUsage.totalTokens ?? 0;
    },
  });

  assert.equal(result.text, 'final answer');
  assert.equal(result.steps.length, 2);
  assert.equal(result.usage.totalTokens, 18);
  assert.equal(result.totalUsage.totalTokens, 23);
  assert.deepEqual(stepFinishes, [
    { text: '', finishReason: 'tool-calls', totalTokens: 5 },
    { text: 'final answer', finishReason: 'stop', totalTokens: 18 },
  ]);
  assert.equal(finishText, 'final answer');
  assert.equal(finishTotalTokens, 23);
});

test('upstream-compat/streamText: thrown model stream errors reject textStream consumers', async () => {
  const modelRef = { modelId: 'text.generate' as const };
  const model: NimiAiModel = {
    model: modelRef,
    async generateText() {
      return { text: '', finishReason: 'error', usage: DEFAULT_USAGE };
    },
    async *streamText(): AsyncIterable<NimiRunEvent> {
      yield { type: 'start', model: modelRef };
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('upstream stream failure');
    },
  };

  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'fail' });

  await assert.rejects(
    async () => convertReadableStreamToArray(result.textStream),
    /upstream stream failure/,
  );
});

test('upstream-compat/streamText: onChunk and onFinish observe adapter stream ordering', async () => {
  const { model } = createUpstreamCompatModel({
    events: [
      { type: 'reasoning-summary-delta', text: 'think', itemIndex: 0, itemCompleted: true },
      { type: 'text-delta', text: 'answer', itemIndex: 1 },
      { type: 'done', finishReason: 'stop', usage: DEFAULT_USAGE },
    ],
  });
  const chunks: string[] = [];
  let finishedText = '';
  let finishReason = '';

  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'callbacks',
    onChunk({ chunk }) {
      chunks.push(chunk.type);
    },
    onFinish(finish) {
      finishedText = finish.text;
      finishReason = finish.finishReason;
    },
  });

  for await (const _part of result.fullStream) {
    // drain
  }

  assert.deepEqual(chunks, ['reasoning-delta', 'text-delta']);
  assert.equal(finishedText, 'answer');
  assert.equal(finishReason, 'stop');
});
