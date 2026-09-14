import assert from 'node:assert/strict';
import test from 'node:test';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { generateText } from 'ai';

import type { NimiClient, NimiClientRuntimeModelOptions } from '@nimiplatform/sdk';
import { isNimiError } from '@nimiplatform/sdk';
import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '@nimiplatform/sdk/ai';
import type {
  NimiFinishReason,
  NimiRunEvent,
  NimiSource,
  NimiToolApprovalRequest,
  NimiToolCall,
  NimiToolResult,
} from '@nimiplatform/sdk/contracts';
import {
  createNimiVercelLanguageModel,
  createNimiVercelProvider,
  type NimiVercelProviderOptions,
} from './index';
import { NIMI_VERCEL_AI_ADAPTER_MANIFEST } from './manifest';

const VERCEL_AI_METADATA_KEY = 'x-nimi-vercel-ai-metadata';

// Adapter-owned conformance suite driving the real Vercel AI SDK.
import './vercel-ai.conformance.test';

test('vercel-ai adapter maps LanguageModelV3 generate calls to Nimi model requests', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model: LanguageModelV3 = createNimiVercelLanguageModel({ model: createModel(calls) });

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 16,
    topK: 4,
    responseFormat: { type: 'json', schema: { type: 'object' }, name: 'Answer' },
    tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
  });

  assert.equal(model.specificationVersion, 'v3');
  assert.equal(model.provider, 'nimi');
  assert.equal(calls[0]?.messages[0]?.role, 'user');
  assert.equal(calls[0]?.tools?.[0]?.name, 'lookup');
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
  assert.equal(calls[0]?.parameters?.topK, 4);
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

test('vercel-ai adapter returns Nimi tool calls without adapter-owned execution', async () => {
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
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'].mode, 'framework-owned');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.adapterExecute'].support, 'not-applicable');
});

test('vercel-ai adapter rejects provider-executed output instead of claiming Runtime parity', async () => {
  const model = createNimiVercelLanguageModel({ model: createModel([], { text: '', toolCalls: [{ id: 'provider-1', name: 'lookup', arguments: {}, providerExecuted: true }] }) });
  await assert.rejects(async () => await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'lookup' }] }] }), /not admitted/);
});

test('vercel-ai adapter maps canonical tool results and rejects provider HTTP settings', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });
  await model.doGenerate({ prompt: [
    { role: 'system', content: 'answer briefly' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-prev', toolName: 'lookup', input: { query: 'nimi' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-prev', toolName: 'lookup', output: { type: 'json', value: { ok: true } } }] },
  ], responseFormat: { type: 'text' } });
  assert.equal(calls[0]?.messages[0]?.role, 'system');
  assert.deepEqual(calls[0]?.messages[2]?.turnItems, [{ type: 'tool-result', toolResult: { toolCallId: 'call-prev', toolName: 'lookup', result: { ok: true } } }]);
  await assert.rejects(async () => await model.doGenerate({ prompt: [], headers: { authorization: 'unowned-provider-secret' } }), /headers/);
  await assert.rejects(async () => await model.doGenerate({ prompt: [], providerOptions: { openai: { reasoningEffort: 'high' } } }), /providerOptions/);
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

test('vercel-ai adapter fails closed when a Nimi stream ends without terminal evidence', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [{ type: 'text-delta', text: 'partial' }],
    }),
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  const reader = result.stream.getReader();
  await assert.rejects(
    async () => {
      for (;;) {
        await reader.read();
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
      return true;
    },
  );
});

test('vercel-ai runtime-backed provider requires explicit external subject mode', () => {
  const client = {
    ai: {
      createRuntimeModel(_options: NimiClientRuntimeModelOptions) {
        return createModel([]);
      },
    },
  } as unknown as NimiClient;

  assert.throws(
    () => createNimiVercelProvider({
      client,
      subjectUserId: 'user-1',
    }).languageModel('model-1'),
    { feature: 'provider.subjectUserId' },
  );
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

test('vercel-ai adapter rejects unadmitted provider tool-result streams', async () => {
  const model = createNimiVercelLanguageModel({ model: createModel([], { stream: [
    { type: 'tool-result', toolResult: { toolCallId: 'provider-1', toolName: 'lookup', result: { value: true } } },
    { type: 'done', finishReason: 'stop' },
  ] }) });
  const result = await model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'lookup' }] }] });
  await assert.rejects(async () => { const reader = result.stream.getReader(); while (!(await reader.read()).done) {} }, /cannot expose tool-result/);
});

test('vercel-ai adapter fails closed on stream errors and unknown terminal reasons', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [
        { type: 'text-delta', text: 'partial' },
        { type: 'warning', code: 'route-degraded', message: 'using fallback' },
        { type: 'error', code: 'partial-error', message: 'reported but stream continued' },
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
    'text-start',
    'text-delta',
    'error',
  ]);
  const errorPart = parts.find((part) => part.type === 'error');
  const streamError = errorPart?.type === 'error' ? errorPart.error : undefined;
  assert.equal(isNimiError(streamError), true);
  assert.equal((streamError as { reasonCode?: string }).reasonCode, 'partial-error');

  const unknownTerminalModel = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [{ type: 'done', finishReason: 'unknown' }],
    }),
  });
  const unknownResult = await unknownTerminalModel.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'stream' }] }],
  });
  const unknownReader = unknownResult.stream.getReader();
  await assert.rejects(
    async () => {
      for (;;) {
        await unknownReader.read();
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN');
      return true;
    },
  );
});

test('vercel-ai adapter rejects provider-defined tools before the backing model runs', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });
  await assert.rejects(async () => await model.doGenerate({ prompt: [], tools: [{ type: 'provider', id: 'test.web', name: 'web', args: {} }] }), /tools.provider/);
  assert.equal(calls.length, 0);
});

test('vercel-ai adapter maps includeRawChunks to Nimi request parameters', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });

  await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    includeRawChunks: true,
  });

  assert.equal(calls[0]?.parameters?.includeRawChunks, true);
});

test('vercel-ai adapter maps file prompt parts onto Nimi file parts', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });

  await model.doGenerate({
    prompt: [{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/png', filename: 'pic.png' },
        { type: 'file', data: 'https://example.com/a.jpg', mediaType: 'image/jpeg' },
        { type: 'file', data: new URL('https://example.com/clip.mp4'), mediaType: 'video/mp4' },
      ],
    }],
  });

  const content = calls[0]?.messages[0]?.content ?? [];
  assert.equal(content.length, 4);
  assert.equal(content[0]?.type, 'text');

  // Binary payload is base64-encoded (btoa of "hi"); the Runtime owns decode.
  assert.deepEqual(content[1], { type: 'file', mediaType: 'image/png', data: 'aGk=', filename: 'pic.png' });
  // String data passes through unchanged.
  assert.deepEqual(content[2], { type: 'file', mediaType: 'image/jpeg', data: 'https://example.com/a.jpg' });
  // URL data is serialized to its href.
  assert.deepEqual(content[3], { type: 'file', mediaType: 'video/mp4', data: 'https://example.com/clip.mp4' });
});

test('vercel-ai adapter fails closed when streaming is unsupported by the Nimi model', async () => {
  const model = createNimiVercelLanguageModel({
    model: {
      model: { modelId: 'text.generate' },
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
    () => createNimiVercelProvider({} as never),
    { feature: 'provider.configuration' },
  );
  assert.throws(
    () => createNimiVercelProvider({
      model: createModel([]),
      client: {} as NimiClient,
    } as unknown as NimiVercelProviderOptions),
    { feature: 'provider.configuration' },
  );
});

test('vercel-ai provider exposes only the text capability facade', () => {
  const provider = createNimiVercelProvider({ model: createModel([]) });

  assert.equal(provider.languageModel('text.generate').modelId, 'text.generate');
  assert.throws(() => provider.languageModel('other'));
});

test('vercel-ai provider exposes the Runtime text capability without forwarding a model target', () => {
  const createdOptions: NimiClientRuntimeModelOptions[] = [];
  const provider = createNimiVercelProvider({
    client: {
      ai: {
        createRuntimeModel(options: NimiClientRuntimeModelOptions) {
          createdOptions.push(options);
          return createModel([]);
        },
      },
    } as unknown as NimiClient,
    subjectUserId: 'user-1',
    subjectMode: 'external-principal',
  });

  assert.equal(provider.languageModel('text.generate').modelId, 'text.generate');
  assert.throws(() => provider.languageModel('gemini/default'));
  assert.equal('model' in createdOptions[0]!, false);
});

test('vercel-ai provider forwards identity context without a model target', () => {
  let captured: NimiClientRuntimeModelOptions | null = null;
  const client = {
    ai: {
      createRuntimeModel(options: NimiClientRuntimeModelOptions) {
        captured = options;
        return createModel([]);
      },
    },
  } as unknown as NimiClient;

  createNimiVercelProvider({
    client,
    subjectUserId: 'user-1',
    subjectMode: 'external-principal',
  }).languageModel('text.generate');

  const capturedOptions = captured as NimiClientRuntimeModelOptions | null;
  assert.equal(capturedOptions && 'model' in capturedOptions, false);
  assert.equal(capturedOptions?.subjectUserId, 'user-1');
});

test('vercel-ai manifest represents supported, partial, and not-applicable capability classes', () => {
  const capabilities = NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities;
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilityLevel, 'L3');
  assert.equal(capabilities['text.generate'].support, 'supported');
  assert.equal(capabilities['tools.callerOwnedLoop'].mode, 'framework-owned');
  assert.equal(capabilities.multimodalInput.support, 'partial');
  assert.equal(capabilities['tools.adapterExecute'].support, 'not-applicable');
  assert.equal(capabilities.rawChunks.support, 'supported');
});

function createModel(
  calls: NimiGenerateTextRequest[],
  fixture: {
    readonly text?: string;
    readonly finishReason?: NimiFinishReason;
    readonly warnings?: readonly { readonly code: string; readonly message: string }[];
    readonly toolCalls?: readonly NimiToolCall[];
    readonly toolResults?: readonly NimiToolResult[];
    readonly toolApprovalRequests?: readonly NimiToolApprovalRequest[];
    readonly sources?: readonly NimiSource[];
    readonly content?: NimiGenerateTextResult['content'];
    readonly stream?: readonly NimiRunEvent[];
  } = {},
): NimiAiModel {
  return {
    model: { modelId: 'text.generate' },
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
        toolResults: fixture.toolResults,
        toolApprovalRequests: fixture.toolApprovalRequests,
        sources: fixture.sources,
        content: fixture.content,
        warnings: fixture.warnings,
      };
    },
    async *streamText(request) {
      calls.push(request);
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
