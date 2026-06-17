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

// Conformance suite driving the real Vercel AI SDK through the adapter. Imported
// here so it runs inside the single-file adapter capability ledger gate.
import './vercel-ai.conformance.test';
import './vercel-ai.upstream-compat.test';

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

test('vercel-ai adapter maps L3 generate content surfaces', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const providerToolCall: NimiToolCall = {
    id: 'provider-call-1',
    name: 'web_search',
    arguments: { query: 'nimi' },
    providerExecuted: true,
    dynamic: true,
    providerMetadata: { test: { call: 'provider' } },
  };
  const source: NimiSource = {
    type: 'source',
    sourceType: 'url',
    id: 'source-1',
    url: 'https://example.com/nimi',
    title: 'Nimi',
    providerMetadata: { test: { source: 'url' } },
  };
  const toolResult: NimiToolResult = {
    toolCallId: 'provider-call-1',
    toolName: 'web_search',
    result: { items: [{ title: 'Nimi' }] },
    preliminary: true,
    dynamic: true,
    providerMetadata: { test: { result: 'preliminary' } },
  };
  const approvalRequest: NimiToolApprovalRequest = {
    approvalId: 'approval-1',
    toolCallId: 'provider-call-1',
    providerMetadata: { test: { approval: 'required' } },
  };
  const model = createNimiVercelLanguageModel({
    model: createModel(calls, {
      text: '',
      content: [
        source,
        { type: 'tool-call', toolCall: providerToolCall },
        { type: 'tool-result', toolResult },
        { type: 'tool-approval-request', toolApprovalRequest: approvalRequest },
        { type: 'raw', value: { ignoredInGenerateContent: true } },
      ],
    }),
  });

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
  });

  assert.deepEqual(result.content.map((part) => part.type), [
    'source',
    'tool-call',
    'tool-result',
    'tool-approval-request',
  ]);
  const toolCallPart = result.content.find((part) => part.type === 'tool-call');
  assert.equal(toolCallPart?.type === 'tool-call' ? toolCallPart.providerExecuted : false, true);
  assert.deepEqual(toolCallPart?.type === 'tool-call' ? toolCallPart.providerMetadata : undefined, { test: { call: 'provider' } });
  const toolResultPart = result.content.find((part) => part.type === 'tool-result');
  assert.equal(toolResultPart?.type === 'tool-result' ? toolResultPart.preliminary : false, true);
  const approvalPart = result.content.find((part) => part.type === 'tool-approval-request');
  assert.equal(approvalPart?.type === 'tool-approval-request' ? approvalPart.approvalId : '', 'approval-1');
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
          {
            type: 'tool-call',
            toolCallId: 'call-prev',
            toolName: 'lookup',
            input: { query: 'nimi' },
            providerExecuted: true,
            providerOptions: { test: { turn: 'assistant' } },
          },
          {
            type: 'tool-result',
            toolCallId: 'provider-call-prev',
            toolName: 'provider_lookup',
            output: { type: 'json', value: { providerOk: true } },
            providerOptions: { test: { turn: 'assistant-result' } },
          },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-prev',
          toolName: 'lookup',
          output: { type: 'json', value: { ok: true } },
          providerOptions: { test: { turn: 'tool-result' } },
        }, {
          type: 'tool-approval-response',
          approvalId: 'approval-prev',
          approved: true,
          reason: 'allowed',
          providerOptions: { test: { turn: 'approval-response' } },
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
  assert.equal(calls[0]?.messages[1]?.toolCalls?.[0]?.providerExecuted, true);
  assert.deepEqual(calls[0]?.messages[1]?.toolCalls?.[0]?.providerMetadata, { test: { turn: 'assistant' } });
  assert.deepEqual(calls[0]?.messages[1]?.toolResults?.[0]?.result, {
    type: 'json',
    value: { providerOk: true },
  });
  assert.equal(calls[0]?.messages[2]?.toolCallId, 'call-prev');
  assert.deepEqual(calls[0]?.messages[2]?.toolResults?.[0]?.result, { type: 'json', value: { ok: true } });
  assert.deepEqual(calls[0]?.messages[3]?.toolApprovalResponses?.[0], {
    approvalId: 'approval-prev',
    approved: true,
    reason: 'allowed',
    providerMetadata: { test: { turn: 'approval-response' } },
  });
  assert.equal(calls[0]?.toolChoice, 'required');
  assert.equal(calls[0]?.responseFormat?.type, 'text');
  assert.deepEqual(
    JSON.parse(String(calls[0]?.parameters?.metadata?.[VERCEL_AI_METADATA_KEY] ?? '{}')),
    { headers: { 'x-nimi-trace': 'trace-1' } },
  );
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

test('vercel-ai runtime-backed provider requires route policy and explicit subject mode', () => {
  const client = {
    ai: {
      createRuntimeModel() {
        return createModel([]);
      },
    },
  } as unknown as NimiClient;

  assert.throws(
    () => createNimiVercelProvider({ client } as never).languageModel('model-1'),
    { feature: 'provider.routePolicy' },
  );
  assert.throws(
    () => createNimiVercelProvider({ client, routePolicy: 'cloud', subjectUserId: 'user-1' }).languageModel('model-1'),
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

test('vercel-ai adapter streams source provider tool result approval and raw chunks', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [
        {
          type: 'source',
          sourceType: 'document',
          id: 'doc-1',
          mediaType: 'application/pdf',
          title: 'Spec',
          filename: 'spec.pdf',
        },
        {
          type: 'tool-call',
          toolCall: {
            id: 'provider-call-stream',
            name: 'web_search',
            arguments: { query: 'nimi' },
            providerExecuted: true,
          },
        },
        {
          type: 'tool-result',
          toolResult: {
            toolCallId: 'provider-call-stream',
            toolName: 'web_search',
            result: { ok: true },
            providerMetadata: { test: { result: 'stream' } },
          },
        },
        {
          type: 'tool-approval-request',
          toolApprovalRequest: { approvalId: 'approval-stream', toolCallId: 'provider-call-stream' },
        },
        { type: 'raw', value: { provider: 'raw-chunk' } },
        { type: 'done', finishReason: 'stop' },
      ],
    }),
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'stream L3' }] }],
    includeRawChunks: true,
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
    'source',
    'tool-input-start',
    'tool-input-delta',
    'tool-input-end',
    'tool-call',
    'tool-result',
    'tool-approval-request',
    'raw',
    'finish',
  ]);
  assert.equal(parts.some((part) => part.type === 'tool-input-start' && part.providerExecuted === true), true);
  const rawPart = parts.find((part) => part.type === 'raw');
  assert.deepEqual(rawPart?.type === 'raw' ? rawPart.rawValue : undefined, { provider: 'raw-chunk' });
});

test('vercel-ai adapter fails closed on stream errors and unknown terminal reasons', async () => {
  const model = createNimiVercelLanguageModel({
    model: createModel([], {
      stream: [
        { type: 'reasoning-delta', text: 'thinking' },
        { type: 'artifact', mimeType: 'text/plain', chunk: new Uint8Array([65]) },
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
    'reasoning-start',
    'reasoning-delta',
    'file',
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

test('vercel-ai adapter maps provider-defined tools to Nimi provider tools', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createNimiVercelLanguageModel({ model: createModel(calls) });

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ type: 'provider', id: 'test.web_search', name: 'web_search', args: { maxResults: 3 } }],
  });

  assert.deepEqual(calls[0]?.tools?.[0], {
    type: 'provider',
    id: 'test.web_search',
    name: 'web_search',
    args: { maxResults: 3 },
  });
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
    subjectMode: 'external-principal',
  });

  assert.equal(provider.languageModel('gemini/default').modelId, 'gemini/default');
  assert.deepEqual(createdModels, ['gemini/default']);
});

test('vercel-ai manifest claims protocol mapping support and types every gap', () => {
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilityLevel, 'L3');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['text.generate'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['text.stream'].support, 'supported');
  // Protocol mapping fidelity proven by the conformance suite against the real Vercel AI SDK.
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['runEvents.toolCallReturn'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['structured.output.requestMapping'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.definitionMapping'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.toolChoiceMapping'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.callerOwnedLoop'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.callerOwnedLoop'].mode, 'framework-owned');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['runEvents.reasoning'].support, 'supported');
  // Target-library execute and multi-step are supported because Vercel owns that orchestration.
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.execute'].mode, 'framework-owned');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.multiStep.support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.multiStep.mode, 'framework-owned');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.adapterExecute'].support, 'not-applicable');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.providerDefined'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.providerExecuted'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.providerToolResults'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities['tools.providerApproval'].support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.deferredResults.support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.approval.support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.externalExecution.support, 'not-applicable');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.traces.support, 'partial');
  // Partial capabilities: claims reflect the bounded reality proven by the conformance suite.
  // multimodalInput maps image/audio/video; other media types and route-dependent paths fail closed.
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.multimodalInput.support, 'partial');
  // multimodalOutput projects only streaming artifact chunks into Vercel file parts.
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.multimodalOutput.support, 'partial');
  // usageTokenDetails projects cache-read + reasoning tokens; cache-write detail is unavailable.
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.usageTokenDetails.support, 'partial');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.providerOptions.support, 'partial');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.sources.support, 'supported');
  assert.equal(NIMI_VERCEL_AI_ADAPTER_MANIFEST.capabilities.rawChunks.support, 'supported');
});

function createModel(
  calls: NimiGenerateTextRequest[],
  fixture: {
    readonly modelId?: string;
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
