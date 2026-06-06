import assert from 'node:assert/strict';
import test from 'node:test';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { generateText } from 'ai';

import type { NimiClient, NimiClientRuntimeModelOptions } from '@nimiplatform/sdk';
import type { NimiAiModel, NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import type { NimiFinishReason, NimiRunEvent, NimiToolCall } from '@nimiplatform/sdk/contracts';
import {
  createNimiVercelLanguageModel,
  createNimiVercelProvider,
  NIMI_VERCEL_AI_UNSUPPORTED_FEATURE_CODE,
  NimiVercelAiUnsupportedFeatureError,
} from './index';
import { NIMI_VERCEL_AI_ADAPTER_MANIFEST } from './manifest';

test('vercel-ai adapter maps LanguageModelV3 generate calls to Nimi model requests', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model: LanguageModelV3 = createNimiVercelLanguageModel({ model: createModel(calls) });

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 16,
    responseFormat: { type: 'json', schema: { type: 'object' }, name: 'Answer' },
    tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
  });

  assert.equal(model.specificationVersion, 'v3');
  assert.equal(model.provider, 'nimi');
  assert.equal(calls[0]?.messages[0]?.role, 'user');
  assert.equal(calls[0]?.tools?.[0]?.name, 'lookup');
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
  assert.deepEqual(result.content, [{ type: 'text', text: 'vercel proof' }]);
  assert.equal(result.finishReason.unified, 'stop');
});

test('vercel-ai adapter model is accepted by Vercel AI SDK generateText', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });

  const result = await generateText({
    model,
    prompt: 'hello',
  });

  assert.equal(result.text, 'vercel proof');
  assert.equal(calls[0]?.messages[0]?.role, 'user');
  assert.equal(calls[0]?.messages[0]?.content[0]?.type, 'text');
});

test('vercel-ai adapter returns Nimi tool calls without claiming tool execution', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const toolCall: NimiToolCall = {
    id: 'call-1',
    name: 'lookup',
    arguments: { query: 'nimi' },
  };
  const model = createNimiVercelLanguageModel({
    model: createModel(calls, { text: '', toolCalls: [toolCall], finishReason: 'tool-calls' }),
  });

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'lookup' }] }],
    tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
    toolChoice: { type: 'tool', toolName: 'lookup' },
  });

  assert.equal(calls[0]?.toolChoice && typeof calls[0].toolChoice === 'object' ? calls[0].toolChoice.name : '', 'lookup');
  assert.deepEqual(result.content, [{
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'lookup',
    input: '{"query":"nimi"}',
  }]);
  assert.equal(result.finishReason.unified, 'tool-calls');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'], 'unsupported');
});

test('vercel-ai adapter maps system tool-result headers and text response format', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({
    model: createModel(calls, {
      finishReason: 'length',
      warnings: [{ code: 'runtime-warning', message: 'degraded route' }],
    }),
  });

  const result = await model.doGenerate({
    prompt: [
      { role: 'system', content: 'answer briefly' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will call a tool.' },
          { type: 'tool-call', toolCallId: 'call-prev', toolName: 'lookup', input: { query: 'nimi' } },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-prev',
          toolName: 'lookup',
          output: { type: 'json', value: { ok: true } },
        }],
      },
      { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    ],
    responseFormat: { type: 'text' },
    toolChoice: { type: 'required' },
    headers: {
      'x-nimi-trace': 'trace-1',
      ignored: undefined,
    },
  });

  assert.equal(calls[0]?.messages[0]?.role, 'system');
  assert.equal(calls[0]?.messages[1]?.toolCalls?.[0]?.name, 'lookup');
  assert.equal(calls[0]?.messages[2]?.toolCallId, 'call-prev');
  assert.equal(calls[0]?.toolChoice, 'required');
  assert.equal(calls[0]?.responseFormat?.type, 'text');
  assert.deepEqual(calls[0]?.parameters?.metadata, {
    vercelAi: {
      headers: {
        'x-nimi-trace': 'trace-1',
      },
    },
  });
  assert.equal(result.finishReason.unified, 'length');
  assert.deepEqual(result.warnings, [{ type: 'other', message: 'runtime-warning: degraded route' }]);
});

test('vercel-ai adapter maps Nimi stream events to LanguageModelV3-like stream parts', async () => {
  const model = createNimiVercelLanguageModel({ model: createModel([]) });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });

  const parts = [];
  const reader = result.stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value.type);
  }

  assert.deepEqual(parts, ['stream-start', 'text-start', 'text-delta', 'text-end', 'finish']);
});

test('vercel-ai adapter streams returned tool-call events as partial run-event mapping', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [
        { type: 'tool-call', toolCall: { id: 'call-stream', name: 'lookup', arguments: { query: 'nimi' } } },
        { type: 'done', finishReason: 'tool-calls' },
      ],
    }),
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'lookup' }] }],
  });

  const parts = [];
  const reader = result.stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value);
  }

  assert.ok(parts.some((part) => part.type === 'tool-call' && part.toolCallId === 'call-stream'));
  assert.ok(parts.some((part) => part.type === 'finish' && part.finishReason.unified === 'tool-calls'));
});

test('vercel-ai adapter maps non-text stream events without inventing parity', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [
        { type: 'reasoning-delta', text: 'thinking' },
        { type: 'artifact', mimeType: 'text/plain', chunk: new Uint8Array([65]) },
        { type: 'warning', code: 'route-degraded', message: 'using fallback' },
        { type: 'error', code: 'partial-error', message: 'reported but stream continued' },
        { type: 'done', finishReason: 'unknown' },
      ],
    }),
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'stream' }] }],
  });

  const parts = [];
  const reader = result.stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value);
  }

  assert.deepEqual(parts.map((part) => part.type), [
    'stream-start',
    'reasoning-start',
    'reasoning-delta',
    'file',
    'raw',
    'error',
    'reasoning-end',
    'finish',
  ]);
  const finish = parts.find((part) => part.type === 'finish');
  assert.equal(finish?.type === 'finish' ? finish.finishReason.unified : '', 'other');
});

test('vercel-ai adapter fails closed for unsupported provider-defined tools', async () => {
  const model = createNimiVercelLanguageModel({ model: createModel([]) });

  await assert.rejects(
    async () => await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ type: 'provider', id: 'nimi.web_search', name: 'web_search', args: {} }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof NimiVercelAiUnsupportedFeatureError);
      assert.equal(error.code, NIMI_VERCEL_AI_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'tools.provider-defined');
      return true;
    },
  );
});

test('vercel-ai adapter fails closed for unsupported call options and prompt parts', async () => {
  const model = createNimiVercelLanguageModel({ model: createModel([]) });

  await assert.rejects(
    async () => await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      topK: 4,
    }),
    { feature: 'settings.topK' },
  );
  await assert.rejects(
    async () => await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      includeRawChunks: true,
    }),
    { feature: 'stream.includeRawChunks' },
  );
  await assert.rejects(
    async () => await model.doGenerate({
      prompt: [{
        role: 'user',
        content: [{ type: 'file', data: new Uint8Array([1]), mediaType: 'image/png' }],
      }],
    }),
    { feature: 'prompt.file' },
  );
});

test('vercel-ai adapter fails closed when streaming is not available', async () => {
  const model = createNimiVercelLanguageModel({
    model: {
      model: { providerId: 'test', modelId: 'no-stream' },
      async generateText() {
        return { text: 'ok', finishReason: 'stop' };
      },
    },
  });

  await assert.rejects(
    async () => await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
    { feature: 'languageModel.doStream' },
  );
});

test('vercel-ai provider fails closed on invalid configuration', () => {
  assert.throws(
    () => createNimiVercelProvider({}),
    { feature: 'provider.configuration' },
  );
  assert.throws(
    () => createNimiVercelProvider({
      model: createModel([]),
      client: {} as NimiClient,
    }),
    { feature: 'provider.configuration' },
  );
});

test('vercel-ai provider exposes only the configured model id', () => {
  const provider = createNimiVercelProvider({ model: createModel([]) });

  assert.equal(provider.languageModel('vercel-model').modelId, 'vercel-model');
  assert.throws(() => provider.languageModel('other'));
});

test('vercel-ai provider can create Runtime-backed models from a Nimi client', () => {
  const createdModels: string[] = [];
  const provider = createNimiVercelProvider({
    client: {
      ai: {
        createRuntimeModel(options: NimiClientRuntimeModelOptions) {
          createdModels.push(options.model.modelId);
          return createModel([], { modelId: options.model.modelId });
        },
      },
    } as unknown as NimiClient,
    routePolicy: 'cloud',
    subjectUserId: 'user-1',
  });

  assert.equal(provider.languageModel('gemini/default').modelId, 'gemini/default');
  assert.deepEqual(createdModels, ['gemini/default']);
});

test('vercel-ai manifest only claims capabilities backed by current implementation', () => {
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilityLevel, 'L2');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['text.generate'], 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['text.stream'], 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['runEvents.toolCallReturn'], 'partial');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['structured.output.requestMapping'], 'partial');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'], 'unsupported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.approval, 'unsupported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.externalExecution, 'unsupported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.traces, 'unsupported');
});

function createModel(
  calls: NimiGenerateTextRequest[],
  fixture: {
    readonly modelId?: string;
    readonly text?: string;
    readonly finishReason?: NimiFinishReason;
    readonly warnings?: readonly { readonly code: string; readonly message: string }[];
    readonly toolCalls?: readonly NimiToolCall[];
    readonly stream?: readonly NimiRunEvent[];
  } = {},
): NimiAiModel {
  return {
    model: { providerId: 'test', modelId: fixture.modelId ?? 'vercel-model' },
    async generateText(request) {
      calls.push(request);
      return {
        text: fixture.text ?? 'vercel proof',
        finishReason: fixture.finishReason ?? 'stop',
        usage: {
          promptTokens: 2,
          completionTokens: 2,
          totalTokens: 4,
        },
        toolCalls: fixture.toolCalls,
        warnings: fixture.warnings,
      };
    },
    async *streamText() {
      if (fixture.stream) {
        yield* fixture.stream;
      } else {
        yield { type: 'text-delta', text: 'vercel proof' };
        yield {
          type: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 2,
            completionTokens: 2,
            totalTokens: 4,
          },
        };
      }
    },
  };
}
