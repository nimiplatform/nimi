import assert from 'node:assert/strict';
import test from 'node:test';

import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai';
import { convertReadableStreamToArray } from 'ai/test';
import { z } from 'zod/v4';

import type { NimiAiModel } from '@nimiplatform/sdk/ai';
import type { NimiModelRef, NimiRunEvent } from '@nimiplatform/sdk/contracts';
import { createNimiVercelLanguageModel } from './index';
import { createUpstreamCompatModel, DEFAULT_USAGE } from './vercel-ai.upstream-compat.fixture';

test('upstream-compat/generateText: provider-executed tool calls do not execute caller tools', async () => {
  const { model } = createUpstreamCompatModel({
    toolCalls: [{
      id: 'provider-call',
      name: 'lookup',
      arguments: { query: 'nimi' },
      providerExecuted: true,
      dynamic: true,
    }],
    finishReason: 'tool-calls',
  });
  let executed = false;

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
        execute: async () => {
          executed = true;
          return 'should not run';
        },
      }),
    },
  });

  assert.equal(executed, false);
  assert.equal(result.toolResults.length, 0);
  assert.equal(result.toolCalls[0]?.providerExecuted, true);
  assert.equal(result.content.find((part) => part.type === 'tool-call')?.type, 'tool-call');
});

test('upstream-compat/generateText: provider-defined tools are forwarded from Vercel high-level calls', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: 'ok' });

  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'provider tool request',
    tools: {
      web_search: {
        type: 'provider',
        id: 'test.web_search',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        args: { maxResults: 3 },
      },
    },
    toolChoice: { type: 'tool', toolName: 'web_search' },
  });

  assert.deepEqual(calls[0]?.tools?.[0], {
    type: 'provider',
    id: 'test.web_search',
    name: 'web_search',
    args: { maxResults: 3 },
  });
  assert.deepEqual(calls[0]?.toolChoice, { type: 'tool', name: 'web_search' });
});

test('upstream-compat/generateText: provider-executed tool results remain framework-visible', async () => {
  const { model } = createUpstreamCompatModel({
    content: [
      {
        type: 'tool-call',
        toolCall: {
          id: 'provider-call-ok',
          name: 'web_search',
          arguments: { value: 'query' },
          providerExecuted: true,
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          toolCallId: 'provider-call-ok',
          toolName: 'web_search',
          result: { value: 'result' },
          providerMetadata: { provider: { itemId: 'result-ok' } },
        },
      },
      {
        type: 'tool-call',
        toolCall: {
          id: 'provider-call-error',
          name: 'web_search',
          arguments: { value: 'bad-query' },
          providerExecuted: true,
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          toolCallId: 'provider-call-error',
          toolName: 'web_search',
          result: 'ERROR',
          isError: true,
          providerMetadata: { provider: { itemId: 'result-error' } },
        },
      },
    ],
    finishReason: 'stop',
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'provider tools',
    stopWhen: stepCountIs(4),
    tools: {
      web_search: {
        type: 'provider',
        id: 'test.web_search',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        }),
        args: {},
      },
    },
  });

  const providerResults = result.content.filter((part) => part.type === 'tool-result');
  const providerErrors = result.content.filter((part) => part.type === 'tool-error');

  assert.equal(result.steps.length, 1);
  assert.equal(result.staticToolCalls.length, 2);
  assert.equal(providerResults.length, 1);
  assert.equal(providerResults[0]?.providerExecuted, true);
  assert.deepEqual(providerResults[0]?.providerMetadata, { provider: { itemId: 'result-ok' } });
  assert.equal(providerErrors.length, 1);
  assert.equal(providerErrors[0]?.providerExecuted, true);
  assert.equal(providerErrors[0]?.error, 'ERROR');
  assert.equal(result.staticToolResults.length, 1);
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

test('upstream-compat/streamText: provider-executed tool results remain visible in full and UI streams', async () => {
  const { model } = createUpstreamCompatModel({
    events: [
      {
        type: 'tool-call',
        toolCall: {
          id: 'provider-stream-ok',
          name: 'web_search',
          arguments: { value: 'query' },
          providerExecuted: true,
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          toolCallId: 'provider-stream-ok',
          toolName: 'web_search',
          result: { value: 'result' },
          providerMetadata: { provider: { itemId: 'stream-ok' } },
        },
      },
      {
        type: 'tool-call',
        toolCall: {
          id: 'provider-stream-error',
          name: 'web_search',
          arguments: { value: 'bad-query' },
          providerExecuted: true,
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          toolCallId: 'provider-stream-error',
          toolName: 'web_search',
          result: { type: 'web_search_error', code: 'blocked' },
          isError: true,
        },
      },
      { type: 'done', finishReason: 'stop', usage: DEFAULT_USAGE },
    ],
  });

  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'stream provider tools',
    stopWhen: stepCountIs(4),
    tools: {
      web_search: {
        type: 'provider',
        id: 'test.web_search',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        }),
        args: {},
      },
    },
  });

  const fullParts = [];
  for await (const part of result.fullStream) {
    fullParts.push(part);
  }
  const uiChunks = await convertReadableStreamToArray(result.toUIMessageStream());
  const content = await result.content;

  assert.equal(content.filter((part) => part.type === 'tool-result').length, 1);
  assert.equal(content.filter((part) => part.type === 'tool-error').length, 1);
  assert.ok(fullParts.some((part) => part.type === 'tool-result' && part.providerExecuted === true));
  assert.ok(fullParts.some((part) => part.type === 'tool-error' && part.providerExecuted === true));
  assert.ok(uiChunks.some((chunk) => chunk.type === 'tool-output-available' && chunk.providerExecuted === true));
  assert.ok(uiChunks.some((chunk) => {
    if (chunk.type !== 'tool-output-error' || typeof chunk.errorText !== 'string') {
      return false;
    }
    const parsed = JSON.parse(chunk.errorText) as { type?: unknown; code?: unknown };
    return parsed.type === 'web_search_error' && parsed.code === 'blocked';
  }));
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

test('upstream-compat/generateText: provider approval request and approved continuation roundtrip', async () => {
  const { model, calls } = createUpstreamCompatModel({
    content: [
      {
        type: 'tool-call',
        toolCall: {
          id: 'mcp-call-1',
          name: 'mcp_tool',
          arguments: { query: 'test' },
          providerExecuted: true,
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          toolCallId: 'mcp-call-1',
          toolName: 'mcp_tool',
          result: { shortened_url: 'https://short.url/abc' },
        },
      },
      { type: 'text', text: 'approved result' },
    ],
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    messages: [
      { role: 'user', content: 'Shorten this URL: https://example.com' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'mcp-call-1',
            toolName: 'mcp_tool',
            input: { query: 'test' },
            providerExecuted: true,
          },
          {
            type: 'tool-approval-request',
            approvalId: 'mcp-approval-1',
            toolCallId: 'mcp-call-1',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'mcp-approval-1',
            approved: true,
            reason: 'allowed',
            providerExecuted: true,
          },
        ],
      },
    ],
    tools: {
      mcp_tool: {
        type: 'provider',
        id: 'test.mcp_tool',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        args: {},
      },
    },
  });

  assert.equal(result.text, 'approved result');
  assert.deepEqual(calls[0]?.messages.find((message) => (message.toolApprovalResponses?.length ?? 0) > 0)?.toolApprovalResponses?.[0], {
    approvalId: 'mcp-approval-1',
    approved: true,
    reason: 'allowed',
  });
  assert.equal(result.content.find((part) => part.type === 'tool-result')?.type, 'tool-result');
});

test('upstream-compat/generateText: denied provider approval response roundtrips without execution', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: 'denied acknowledged' });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    messages: [
      { role: 'user', content: 'Use MCP tool' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'mcp-call-denied',
            toolName: 'mcp_tool',
            input: { query: 'test' },
            providerExecuted: true,
          },
          {
            type: 'tool-approval-request',
            approvalId: 'mcp-approval-denied',
            toolCallId: 'mcp-call-denied',
          },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-approval-response',
          approvalId: 'mcp-approval-denied',
          approved: false,
          reason: 'not allowed',
          providerExecuted: true,
        }],
      },
    ],
    tools: {
      mcp_tool: {
        type: 'provider',
        id: 'test.mcp_tool',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        }),
        args: {},
      },
    },
  });

  assert.equal(result.text, 'denied acknowledged');
  assert.deepEqual(calls[0]?.messages.find((message) => (message.toolApprovalResponses?.length ?? 0) > 0)?.toolApprovalResponses?.[0], {
    approvalId: 'mcp-approval-denied',
    approved: false,
    reason: 'not allowed',
  });
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
  const modelRef: NimiModelRef = { providerId: 'mock', modelId: 'throwing-stream-model' };
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
      { type: 'reasoning-delta', text: 'think' },
      { type: 'text-delta', text: 'answer' },
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
