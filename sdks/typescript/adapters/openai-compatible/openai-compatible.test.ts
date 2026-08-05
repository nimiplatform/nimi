import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAiModel, NimiGenerateTextRequest } from '../../core/ai';
import type { NimiFinishReason } from '../../core/contracts';
import { isNimiError } from '../../types';
import {
  createNimiOpenAICompatibleAdapter,
  NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST,
  NIMI_OPENAI_COMPATIBLE_UNSUPPORTED_FEATURE_CODE,
  NimiOpenAICompatibleUnsupportedFeatureError,
  normalizeOpenAICompatibleChatRequest,
  type OpenAICompatibleChatCompletion,
  type OpenAICompatibleChatCompletionChunk,
  type OpenAICompatibleTool,
} from './index';

test('openai-compatible adapter maps chat content without forwarding the compatibility model alias', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createFakeModel(calls);
  const client = createNimiOpenAICompatibleAdapter({
    model,
    idGenerator: () => 'chatcmpl-test',
    createdUnixSeconds: () => 123,
  });

  const completion = await client.chat.completions.create({
    model: 'kimi-nimi',
    messages: [
      { role: 'developer', content: 'Use short answers.' },
      { role: 'user', content: 'Ping?' },
    ],
    temperature: 0.2,
    max_completion_tokens: 64,
    response_format: { type: 'json_object' },
  });

  assert.equal(completion.id, 'chatcmpl-test');
  assert.equal(completion.object, 'chat.completion');
  assert.equal(completion.created, 123);
  assert.equal(completion.model, 'kimi-nimi');
  assert.equal(completion.choices[0].message.content, 'pong');
  assert.equal(completion.choices[0].finish_reason, 'stop');
  assert.deepEqual(completion.usage, {
    prompt_tokens: 3,
    completion_tokens: 1,
    total_tokens: 4,
  });
  assert.equal(calls[0] && 'model' in calls[0], false);
  assert.equal(calls[0]?.messages[0]?.role, 'developer');
  assert.equal(calls[0]?.parameters?.temperature, 0.2);
  assert.equal(calls[0]?.parameters?.maxTokens, 64);
  assert.equal(calls[0]?.responseFormat?.type, 'json-object');
});

test('openai-compatible adapter returns tool_calls without executing tools', async () => {
  const calls: NimiGenerateTextRequest[] = [];
  const model = createFakeModel(calls, {
    text: '',
    finishReason: 'tool-calls',
    toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { query: 'nimi' } }],
  });
  const client = createNimiOpenAICompatibleAdapter({
    model,
    idGenerator: () => 'chatcmpl-tools',
    createdUnixSeconds: () => 456,
  });

  const completion = await client.chat.completions.create({
    model: 'kimi-nimi',
    messages: [{ role: 'user', content: 'Lookup Nimi.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup information.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
          strict: true,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'lookup' } },
  });

  assert.equal(calls[0]?.tools?.[0]?.name, 'lookup');
  assert.equal(calls[0]?.toolChoice && typeof calls[0].toolChoice === 'object' ? calls[0].toolChoice.name : '', 'lookup');
  assert.equal(completion.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(completion.choices[0].message.tool_calls, [
    {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'lookup',
        arguments: '{"query":"nimi"}',
      },
    },
  ]);
});

test('openai-compatible adapter maps streaming chat chunks', async () => {
  const model = createFakeModel([], {
    stream: [
      { type: 'start' },
      { type: 'text-delta', text: 'po' },
      { type: 'text-delta', text: 'ng' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const client = createNimiOpenAICompatibleAdapter({
    model,
    idGenerator: () => 'chatcmpl-stream',
    createdUnixSeconds: () => 789,
  });

  const stream = client.chat.completions.create({
    model: 'kimi-nimi',
    messages: [{ role: 'user', content: 'Ping?' }],
    stream: true,
  });

  const chunks: OpenAICompatibleChatCompletionChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.deepEqual(
    chunks.map((chunk) => chunk.choices[0].delta),
    [{ role: 'assistant' }, { content: 'po' }, { content: 'ng' }, {}],
  );
  assert.equal(chunks.at(-1)?.choices[0].finish_reason, 'stop');
});

test('openai-compatible adapter preserves structured Nimi stream errors', async () => {
  const client = createNimiOpenAICompatibleAdapter({
    model: createFakeModel([], {
      stream: [
        { type: 'text-delta', text: 'partial' },
        { type: 'error', code: 'SDK_STREAM_TEST_FAILURE', message: 'stream failed' },
      ],
    }),
  });
  const stream = client.chat.completions.create({
    model: 'kimi-nimi',
    messages: [{ role: 'user', content: 'Ping?' }],
    stream: true,
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // Consume until the structured stream error is surfaced.
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_STREAM_TEST_FAILURE');
      assert.equal((error as { code?: string }).code, 'SDK_STREAM_TEST_FAILURE');
      assert.equal((error as { actionHint?: string }).actionHint, 'check_ai_stream_event');
      return true;
    },
  );
});

test('openai-compatible adapter fails closed with structured error when stream done is missing', async () => {
  const client = createNimiOpenAICompatibleAdapter({
    model: createFakeModel([], {
      stream: [{ type: 'text-delta', text: 'partial' }],
    }),
  });
  const stream = client.chat.completions.create({
    model: 'kimi-nimi',
    messages: [{ role: 'user', content: 'Ping?' }],
    stream: true,
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // Consume until the missing terminal evidence is detected.
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
      return true;
    },
  );
});

test('openai-compatible adapter fails closed on unknown Nimi finish reasons', async () => {
  const nonStreaming = createNimiOpenAICompatibleAdapter({
    model: createFakeModel([], { finishReason: 'unknown' }),
  });
  await assert.rejects(
    nonStreaming.chat.completions.create({
      model: 'kimi-nimi',
      messages: [{ role: 'user', content: 'Ping?' }],
    }),
    (error: unknown) => {
      assert.equal(error instanceof NimiOpenAICompatibleUnsupportedFeatureError, true);
      assert.equal((error as NimiOpenAICompatibleUnsupportedFeatureError).feature, 'finishReason');
      return true;
    },
  );

  const streaming = createNimiOpenAICompatibleAdapter({
    model: createFakeModel([], {
      stream: [
        { type: 'start' },
        { type: 'done', finishReason: 'unknown' },
      ],
    }),
  });
  const stream = streaming.chat.completions.create({
    model: 'kimi-nimi',
    messages: [{ role: 'user', content: 'Ping?' }],
    stream: true,
  });
  await assert.rejects(
    async () => {
      for await (const _chunk of stream) {
        // Consume until the terminal unsupported finish reason is observed.
      }
    },
    (error: unknown) => {
      assert.equal(error instanceof NimiOpenAICompatibleUnsupportedFeatureError, true);
      assert.equal((error as NimiOpenAICompatibleUnsupportedFeatureError).feature, 'finishReason');
      return true;
    },
  );
});

test('openai-compatible adapter fails closed on unsupported OpenAI compatibility features', () => {
  const client = createNimiOpenAICompatibleAdapter({ model: createFakeModel([]) });

  assertUnsupported(() => {
    client.chat.completions.create({
      model: 'kimi-nimi',
      messages: [{ role: 'user', content: 'Ping?' }],
      n: 2,
    });
  }, 'n');

  assertUnsupported(() => {
    client.chat.completions.create({
      model: 'kimi-nimi',
      messages: [{ role: 'user', content: 'Ping?' }],
      tools: [{ type: 'web_search_preview' } as unknown as OpenAICompatibleTool],
    });
  }, 'tools.web_search_preview');

  assertUnsupported(() => {
    client.chat.completions.create({
      model: 'kimi-nimi',
      messages: [{ role: 'user', content: 'Ping?' }],
      logprobs: true,
    });
  }, 'logprobs');

  assertUnsupported(() => {
    normalizeOpenAICompatibleChatRequest({
      model: 'kimi-nimi',
      messages: [{ role: 'user', content: 'Ping?' }],
      store: true,
    } as never);
  }, 'chat.completions.create.request.store');
});

test('openai-compatible manifest declares migration bridge boundaries', () => {
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilityLevel, 'L2');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilities['chat.completions.create'].support, 'supported');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilities.responsesApi.support, 'unsupported');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilities.runtimeRestBypass.support, 'unsupported');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilities.runtimeRestBypass.mode, 'owner-gated');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.unsupportedBehavior, 'throw');
});

function createFakeModel(
  calls: NimiGenerateTextRequest[],
  result: Partial<OpenAICompatibleChatCompletionResultFixture> = {},
): NimiAiModel {
  return {
    model: {
      modelId: 'text.generate',
    },
    async generateText(request) {
      calls.push(request);
      return {
        text: result.text ?? 'pong',
        finishReason: result.finishReason ?? 'stop',
        usage: {
          promptTokens: 3,
          completionTokens: 1,
          totalTokens: 4,
        },
        toolCalls: result.toolCalls,
      };
    },
    async *streamText() {
      const stream = result.stream ?? [
        { type: 'text-delta' as const, text: 'pong' },
        { type: 'done' as const, finishReason: 'stop' as const },
      ];
      for (const event of stream) {
        yield event;
      }
    },
  };
}

interface OpenAICompatibleChatCompletionResultFixture {
  readonly text: string;
  readonly finishReason: NimiFinishReason;
  readonly toolCalls: readonly { readonly id: string; readonly name: string; readonly arguments: { readonly [key: string]: string } }[];
  readonly stream: readonly (
    | { readonly type: 'start' }
    | { readonly type: 'text-delta'; readonly text: string }
    | { readonly type: 'done'; readonly finishReason: NimiFinishReason }
    | { readonly type: 'error'; readonly code: string; readonly message: string }
  )[];
}

function assertUnsupported(action: () => unknown, feature: string): void {
  assert.throws(
    action,
    (error: unknown) => {
      assert.ok(error instanceof NimiOpenAICompatibleUnsupportedFeatureError);
      assert.equal(error.code, NIMI_OPENAI_COMPATIBLE_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, feature);
      return true;
    },
  );
}
