// Conformance suite: drive the real Vercel AI SDK (`ai`) high-level functions
// through the Nimi adapter, backed by a scripted in-memory NimiAiModel. This
// mirrors the scenario matrix of the Vercel AI SDK's own generate-text /
// stream-text / generate-object tests so the adapter is validated against the
// real framework code paths, not a hand-rolled stand-in.
//
// Imported by `vercel-ai.test.ts` so it runs inside the adapter capability
// ledger gate.
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateObject, generateText, jsonSchema, stepCountIs, streamObject, streamText, tool } from 'ai';

import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '@nimiplatform/sdk/ai';
import type { NimiFinishReason, NimiRunEvent, NimiToolCall, NimiUsage } from '@nimiplatform/sdk/contracts';
import { createNimiVercelLanguageModel, createNimiVercelProvider } from './index';

const VERCEL_AI_METADATA_KEY = 'x-nimi-vercel-ai-metadata';
const citySchema = jsonSchema<{ city: string }>({
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
  additionalProperties: false,
});

const cityInfoSchema = jsonSchema<{ city: string; population: number }>({
  type: 'object',
  properties: { city: { type: 'string' }, population: { type: 'number' } },
  required: ['city', 'population'],
  additionalProperties: false,
});

function weatherTool(execute?: (input: { city: string }) => Promise<string>) {
  if (execute) {
    return tool({ description: 'weather', inputSchema: citySchema, execute });
  }
  return tool({ description: 'weather', inputSchema: citySchema });
}

interface MockStep {
  readonly text?: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly finishReason?: NimiFinishReason;
  readonly usage?: NimiUsage;
  readonly warnings?: readonly { readonly code: string; readonly message: string }[];
}

interface MockNimiModel {
  readonly model: NimiAiModel;
  readonly calls: NimiGenerateTextRequest[];
}

const DEFAULT_USAGE: NimiUsage = { promptTokens: 4, completionTokens: 6, totalTokens: 10 };

function stepFinishReason(step: MockStep): NimiFinishReason {
  return step.finishReason ?? (step.toolCalls && step.toolCalls.length > 0 ? 'tool-calls' : 'stop');
}

function mockNimiModel(steps: MockStep | readonly MockStep[]): MockNimiModel {
  const script = Array.isArray(steps) ? [...(steps as readonly MockStep[])] : [steps as MockStep];
  const modelRef = { modelId: 'text.generate' as const };
  const calls: NimiGenerateTextRequest[] = [];
  let generateIndex = 0;
  let streamIndex = 0;
  const at = (index: number): MockStep => script[Math.min(index, script.length - 1)] ?? {};

  const toResult = (step: MockStep): NimiGenerateTextResult => ({
    text: step.text ?? '',
    finishReason: stepFinishReason(step),
    usage: step.usage ?? DEFAULT_USAGE,
    toolCalls: step.toolCalls,
    warnings: step.warnings,
    ...(step.reasoning ? { raw: { reasoning: step.reasoning } } : {}),
  });

  const model: NimiAiModel = {
    model: modelRef,
    async generateText(request) {
      calls.push(request);
      const step = at(generateIndex);
      generateIndex += 1;
      return toResult(step);
    },
    async *streamText(request): AsyncIterable<NimiRunEvent> {
      calls.push(request);
      const step = at(streamIndex);
      streamIndex += 1;
      yield { type: 'start', model: modelRef };
      if (step.reasoning) {
        yield { type: 'reasoning-delta', text: step.reasoning };
      }
      for (const chunk of chunkText(step.text ?? '')) {
        yield { type: 'text-delta', text: chunk };
      }
      for (const toolCall of step.toolCalls ?? []) {
        yield { type: 'tool-call', toolCall };
      }
      yield { type: 'done', finishReason: stepFinishReason(step), usage: step.usage ?? DEFAULT_USAGE };
    },
  };

  return { model, calls };
}

function chunkText(text: string): string[] {
  if (text.length <= 1) {
    return text.length === 0 ? [] : [text];
  }
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)];
}

// ---------------------------------------------------------------------------
// generateText
// ---------------------------------------------------------------------------

test('conformance/generateText: basic text generation', async () => {
  const { model, calls } = mockNimiModel({ text: 'Hello, world!' });
  const result = await generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'hi' });

  assert.equal(result.text, 'Hello, world!');
  assert.equal(result.finishReason, 'stop');
  assert.equal(calls[0]?.messages[0]?.role, 'user');
  assert.equal(calls[0]?.messages[0]?.content[0]?.type, 'text');
});

test('conformance/generateText: maps usage tokens including cache and reasoning detail', async () => {
  const { model } = mockNimiModel({
    text: 'ok',
    usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18, cachedInputTokens: 4, reasoningOutputTokens: 3 },
  });
  const result = await generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'hi' });

  assert.equal(result.usage.inputTokens, 10);
  assert.equal(result.usage.outputTokens, 8);
  assert.equal(result.usage.totalTokens, 18);
  assert.equal(result.usage.inputTokenDetails.cacheReadTokens, 4);
  assert.equal(result.usage.outputTokenDetails.reasoningTokens, 3);
});

test('conformance/generateText: surfaces reasoning text', async () => {
  const { model } = mockNimiModel({ text: 'Answer', reasoning: 'Let me think.' });
  const result = await generateText({ model: createNimiVercelLanguageModel({ model }), prompt: 'q' });

  assert.equal(result.reasoningText, 'Let me think.');
  assert.equal(result.text, 'Answer');
});

test('conformance/generateText: returns client-executed tool calls', async () => {
  const { model, calls } = mockNimiModel({
    toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Paris' } }],
    finishReason: 'tool-calls',
  });
  const weather = weatherTool();
  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'weather in Paris',
    tools: { weather },
  });

  assert.equal(result.finishReason, 'tool-calls');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.toolName, 'weather');
  assert.deepEqual(result.toolCalls[0]?.input, { city: 'Paris' });
  assert.equal(calls[0]?.tools?.[0]?.name, 'weather');
});

test('conformance/generateText: executes client tools and returns tool results', async () => {
  const { model } = mockNimiModel({
    toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Paris' } }],
    finishReason: 'tool-calls',
  });
  const weather = weatherTool(async ({ city }) => `sunny in ${city}`);
  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'weather in Paris',
    tools: { weather },
  });

  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.output, 'sunny in Paris');
});

test('conformance/generateText: surfaces caller-owned approval requests before execution', async () => {
  const { model } = mockNimiModel({
    toolCalls: [{ id: 'call-approval', name: 'weather', arguments: { city: 'Paris' } }],
    finishReason: 'tool-calls',
  });
  let executed = false;
  const weather = tool({
    description: 'weather',
    inputSchema: citySchema,
    needsApproval: true,
    execute: async ({ city }) => {
      executed = true;
      return `sunny in ${city}`;
    },
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'weather in Paris',
    tools: { weather },
  });

  const approvalRequest = result.content.find((part) => part.type === 'tool-approval-request');
  assert.ok(approvalRequest);
  assert.equal(approvalRequest.type, 'tool-approval-request');
  assert.equal(approvalRequest.toolCall.toolName, 'weather');
  assert.equal(result.toolResults.length, 0);
  assert.equal(executed, false);
});

test('conformance/generateText: multi-step threads tool result back into the model prompt', async () => {
  const { model, calls } = mockNimiModel([
    { toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Paris' } }], finishReason: 'tool-calls' },
    { text: 'It is sunny in Paris.', finishReason: 'stop' },
  ]);
  const weather = weatherTool(async ({ city }) => `sunny in ${city}`);
  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'weather in Paris',
    tools: { weather },
    stopWhen: stepCountIs(3),
  });

  assert.equal(result.steps.length, 2);
  assert.equal(result.text, 'It is sunny in Paris.');

  const secondCall = calls[1];
  assert.ok(secondCall, 'expected a second model call');
  const assistant = secondCall.messages.find((message) => message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0);
  assert.equal(assistant?.toolCalls?.[0]?.name, 'weather');
  const toolMessage = secondCall.messages.find((message) => message.role === 'tool');
  assert.equal(toolMessage?.toolCallId, 'call-1');
  assert.ok(
    toolMessage?.content.some((part) => part.type === 'text' && part.text.includes('sunny in Paris')),
    'tool result text must be threaded back to the model',
  );
});

test('conformance/generateText: maps required tool choice into the Nimi request', async () => {
  const { model, calls } = mockNimiModel({
    toolCalls: [{ id: 'c', name: 'weather', arguments: { city: 'X' } }],
    finishReason: 'tool-calls',
  });
  const weather = weatherTool();
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'q',
    tools: { weather },
    toolChoice: 'required',
  });

  assert.equal(calls[0]?.toolChoice, 'required');
});

test('conformance/generateText: projects providerOptions into request metadata', async () => {
  const { model, calls } = mockNimiModel({ text: 'ok' });
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'hi',
    providerOptions: { nimi: { correlation: 'upstream-test' } },
  });

  const encodedMetadata = calls[0]?.parameters?.metadata?.[VERCEL_AI_METADATA_KEY];
  const metadata = JSON.parse(String(encodedMetadata ?? '{}')) as { providerOptions?: unknown; headers?: unknown };
  assert.deepEqual(metadata.providerOptions, { nimi: { correlation: 'upstream-test' } });
  if (metadata.headers !== undefined) {
    assert.equal(typeof metadata.headers, 'object');
  }
});

// ---------------------------------------------------------------------------
// streamText
// ---------------------------------------------------------------------------

test('conformance/streamText: streams text deltas, usage, and finish reason', async () => {
  const { model } = mockNimiModel({ text: 'Hello, world!', usage: { promptTokens: 2, completionTokens: 8, totalTokens: 10 } });
  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'hi' });

  let text = '';
  for await (const delta of result.textStream) {
    text += delta;
  }
  assert.equal(text, 'Hello, world!');
  assert.equal(await result.finishReason, 'stop');
  assert.equal((await result.usage).outputTokens, 8);
});

test('conformance/streamText: streams tool calls through the tool-input protocol', async () => {
  const { model } = mockNimiModel({
    toolCalls: [{ id: 'call-stream', name: 'weather', arguments: { city: 'Paris' } }],
    finishReason: 'tool-calls',
  });
  const weather = weatherTool();
  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'q', tools: { weather } });

  const partTypes: string[] = [];
  for await (const part of result.fullStream) {
    partTypes.push(part.type);
  }
  const toolCalls = await result.toolCalls;

  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.toolName, 'weather');
  assert.deepEqual(toolCalls[0]?.input, { city: 'Paris' });
  assert.ok(partTypes.includes('tool-input-start'), 'expected tool-input streaming parts');
  assert.ok(partTypes.includes('tool-call'));
});

test('conformance/streamText: streams reasoning deltas', async () => {
  const { model } = mockNimiModel({ text: 'Answer', reasoning: 'thinking about it' });
  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'q' });

  for await (const _part of result.fullStream) {
    // drain
  }
  assert.equal(await result.reasoningText, 'thinking about it');
  assert.equal(await result.text, 'Answer');
});

test('conformance/streamText: multi-step streaming threads tool results', async () => {
  const { model } = mockNimiModel([
    { toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Paris' } }], finishReason: 'tool-calls' },
    { text: 'It is sunny.', finishReason: 'stop' },
  ]);
  const weather = weatherTool(async ({ city }) => `sunny in ${city}`);
  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'weather',
    tools: { weather },
    stopWhen: stepCountIs(3),
  });

  for await (const _part of result.fullStream) {
    // drain
  }
  assert.equal(await result.text, 'It is sunny.');
  assert.equal((await result.steps).length, 2);
});

// ---------------------------------------------------------------------------
// generateObject / streamObject (structured output)
// ---------------------------------------------------------------------------

test('conformance/generateObject: parses structured JSON output', async () => {
  const { model, calls } = mockNimiModel({ text: JSON.stringify({ city: 'Paris', population: 2 }) });
  const result = await generateObject({
    model: createNimiVercelLanguageModel({ model }),
    schema: cityInfoSchema,
    prompt: 'describe a city',
  });

  assert.deepEqual(result.object, { city: 'Paris', population: 2 });
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
});

test('conformance/streamObject: streams partial objects to a final object', async () => {
  const { model } = mockNimiModel({ text: JSON.stringify({ city: 'Paris' }) });
  const result = streamObject({
    model: createNimiVercelLanguageModel({ model }),
    schema: citySchema,
    prompt: 'a city',
  });

  for await (const _partial of result.partialObjectStream) {
    // drain
  }
  assert.deepEqual(await result.object, { city: 'Paris' });
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour surfaced through the real framework
// ---------------------------------------------------------------------------

test('conformance/generateText: maps multimodal image file input onto a Nimi file part', async () => {
  const { model, calls } = mockNimiModel({ text: 'a cat' });
  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    maxRetries: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/png' },
      ],
    }],
  });

  assert.equal(result.text, 'a cat');
  const content = calls[0]?.messages[0]?.content ?? [];
  assert.equal(content[1]?.type, 'file');
  assert.deepEqual(content[1], { type: 'file', mediaType: 'image/png', data: 'aGk=' });
});

test('conformance/streamText: maps multimodal image file input onto a Nimi file part', async () => {
  const { model, calls } = mockNimiModel({ text: 'streamed' });
  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/png' },
      ],
    }],
  });

  let text = '';
  for await (const delta of result.textStream) {
    text += delta;
  }
  assert.equal(text, 'streamed');
  const content = calls[0]?.messages[0]?.content ?? [];
  assert.deepEqual(content[1], { type: 'file', mediaType: 'image/png', data: 'aGk=' });
});

test('conformance/generateText: maps audio file input onto a Nimi file part', async () => {
  const { model, calls } = mockNimiModel({ text: 'heard' });
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'transcribe' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'audio/wav' },
      ],
    }],
  });

  const content = calls[0]?.messages[0]?.content ?? [];
  assert.deepEqual(content[1], { type: 'file', mediaType: 'audio/wav', data: 'aGk=' });
});

test('conformance/generateText: maps multiple file parts including a URL-sourced image', async () => {
  const { model, calls } = mockNimiModel({ text: 'compared' });
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'compare these' },
        { type: 'file', data: new URL('https://example.com/a.png'), mediaType: 'image/png' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/jpeg' },
      ],
    }],
  });

  const content = calls[0]?.messages[0]?.content ?? [];
  assert.equal(content.length, 3);
  // URL data serializes to its href; the Runtime owns fetch + decode (S-AIP-001).
  assert.deepEqual(content[1], { type: 'file', mediaType: 'image/png', data: 'https://example.com/a.png' });
  assert.deepEqual(content[2], { type: 'file', mediaType: 'image/jpeg', data: 'aGk=' });
});

test('conformance/streamText: surfaces a model error run event through the framework stream', async () => {
  const modelRef = { modelId: 'text.generate' as const };
  const model: NimiAiModel = {
    model: modelRef,
    async generateText(): Promise<NimiGenerateTextResult> {
      return { text: '', finishReason: 'error', usage: DEFAULT_USAGE };
    },
    async *streamText(): AsyncIterable<NimiRunEvent> {
      yield { type: 'start', model: modelRef };
      yield { type: 'error', code: 'RUNTIME_FAULT', message: 'runtime refused the request' };
    },
  };

  const result = streamText({ model: createNimiVercelLanguageModel({ model }), prompt: 'q' });
  const partTypes: string[] = [];
  for await (const part of result.fullStream) {
    partTypes.push(part.type);
  }

  assert.ok(partTypes.includes('error'), 'expected the model error run event to surface as a framework error part');
});

test('conformance/generateText: maps a specific tool choice into the Nimi request', async () => {
  const { model, calls } = mockNimiModel({
    toolCalls: [{ id: 'c', name: 'weather', arguments: { city: 'X' } }],
    finishReason: 'tool-calls',
  });
  const weather = weatherTool();
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'q',
    tools: { weather },
    toolChoice: { type: 'tool', toolName: 'weather' },
  });

  const toolChoice = calls[0]?.toolChoice;
  assert.equal(typeof toolChoice === 'object' && toolChoice?.type === 'tool' ? toolChoice.name : '', 'weather');
});

test('conformance/generateText: projects top-k sampling into Nimi request parameters', async () => {
  const { model, calls } = mockNimiModel({ text: 'x' });
  await generateText({
    model: createNimiVercelLanguageModel({ model }),
    maxRetries: 0,
    prompt: 'hi',
    topK: 5,
  });

  assert.equal(calls[0]?.parameters?.topK, 5);
});

test('conformance/provider: Runtime-style provider drives generateText through the text capability facade', async () => {
  const { model } = mockNimiModel({ text: 'from provider' });
  const provider = createNimiVercelProvider({ model });
  const result = await generateText({ model: provider.languageModel('text.generate'), prompt: 'hi' });

  assert.equal(result.text, 'from provider');
});
