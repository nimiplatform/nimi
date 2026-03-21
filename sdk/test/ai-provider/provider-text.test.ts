import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiAiProvider } from '../../src/ai-provider/index.js';
import { asNimiError, Runtime } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { textDelta, textGenerateOutput } from '../helpers/runtime-ai-shapes.js';
import { APP_ID, SUBJECT_USER_ID, createRuntimeStub } from './provider-test-helpers.js';

test('createNimiAiProvider requires Runtime class instance', () => {
  let thrown: unknown = null;

  try {
    createNimiAiProvider({
      runtime: { ai: {} } as unknown as Runtime,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED);
});

test('createNimiAiProvider accepts missing subjectUserId and keeps request subject unset', async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    generate: async (request) => {
      capturedRequest = request as Record<string, unknown>;
      return {
        output: textGenerateOutput('hello without explicit subject') as unknown as Record<string, unknown>,
        finishReason: 1,
        usage: {
          inputTokens: '1',
          outputTokens: '1',
        },
        routeDecision: 1,
        modelResolved: 'chat/default',
        traceId: 'trace-no-subject',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
  });

  const model = nimi('chat/default');
  const result = await model.doGenerate({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.subjectUserId, '');
  assert.equal(result.content[0]?.type, 'text');
});

test('createNimiAiProvider text model maps runtime generate response', async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    generate: async (request) => {
      capturedRequest = request as Record<string, unknown>;
      return {
        output: textGenerateOutput('hello from runtime') as unknown as Record<string, unknown>,
        finishReason: 1,
        usage: {
          inputTokens: '14',
          outputTokens: '7',
        },
        routeDecision: 1,
        modelResolved: 'chat/default',
        traceId: 'trace-generate',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  const model = nimi('chat/default');
  const result = await model.doGenerate({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.appId, APP_ID);
  assert.equal(capturedRequest.subjectUserId, SUBJECT_USER_ID);
  assert.equal(capturedRequest.routePolicy, 1);
  assert.equal(capturedRequest.fallback, 1);
  assert.deepEqual(result.content, [{
    type: 'text',
    text: 'hello from runtime',
  }]);
  assert.equal(result.finishReason.unified, 'stop');
  assert.equal(result.usage.inputTokens.total, 14);
  assert.equal(result.usage.outputTokens.total, 7);
});

test('createNimiAiProvider text model rejects video chat parts for text chat v1', async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    generate: async (request) => {
      capturedRequest = request as Record<string, unknown>;
      return {
        output: {
          fields: {
            text: {
              kind: {
                oneofKind: 'stringValue',
                stringValue: 'multimodal ok',
              },
            },
          },
        },
        finishReason: 1,
        usage: {
          inputTokens: '5',
          outputTokens: '3',
        },
        routeDecision: 1,
        modelResolved: 'chat/default',
        traceId: 'trace-multimodal-generate',
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');

  await model.doGenerate({
    prompt: [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'system instructions' },
          { type: 'file', mediaType: 'image/png', data: 'https://example.com/system.png' },
        ] as never,
      },
      {
        role: 'user',
        content: [
          { type: 'file', mediaType: 'image/png', data: 'https://example.com/image.png' },
          { type: 'file', mediaType: 'video/mp4', data: 'https://example.com/video.mp4' },
          { type: 'text', text: 'describe the scene' },
        ] as never,
      },
    ],
    providerOptions: {},
  });

  assert.notEqual(capturedRequest, null);
});

test('createNimiAiProvider text streaming maps delta and finish events', async () => {
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      yield {
        traceId: 'trace-stream',
        payload: {
          oneofKind: 'started',
          started: {
            routeDecision: 2,
            modelResolved: 'chat/stream-resolved',
          },
        },
      };
      yield {
        payload: {
          oneofKind: 'delta',
          delta: textDelta('he'),
        },
      };
      yield {
        payload: {
          oneofKind: 'delta',
          delta: textDelta('llo'),
        },
      };
      yield {
        payload: {
          oneofKind: 'usage',
          usage: {
            inputTokens: '4',
            outputTokens: '2',
          },
        },
      };
      yield {
        traceId: 'trace-stream',
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: 1,
            usage: {
              inputTokens: '99',
              outputTokens: '99',
            },
          },
        },
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');
  const streamResult = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  const reader = streamResult.stream.getReader();
  const parts: Array<{
    type?: string;
    delta?: string;
    finishReason?: { unified?: string };
    usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
    providerMetadata?: { nimi?: { traceId?: string; routeDecision?: string; modelResolved?: string } };
  }> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value as {
      type?: string;
      delta?: string;
      finishReason?: { unified?: string };
      usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
      providerMetadata?: { nimi?: { traceId?: string; routeDecision?: string; modelResolved?: string } };
    });
  }

  assert.ok(parts.some((part) => part.type === 'text-delta' && part.delta === 'he'));
  assert.ok(parts.some((part) => part.type === 'text-delta' && part.delta === 'llo'));
  assert.ok(parts.some((part) => part.type === 'finish' && part.finishReason?.unified === 'stop'));
  assert.ok(parts.some((part) => part.type === 'finish' && part.usage?.inputTokens?.total === 4 && part.usage?.outputTokens?.total === 2));
  assert.ok(parts.some((part) => part.type === 'finish'
    && part.providerMetadata?.nimi?.traceId === 'trace-stream'
    && part.providerMetadata?.nimi?.routeDecision === 'cloud'
    && part.providerMetadata?.nimi?.modelResolved === 'chat/stream-resolved'));
});

test('createNimiAiProvider text streaming falls back to completed usage when the usage event is absent', async () => {
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      yield {
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: 1,
            usage: {
              inputTokens: '8',
              outputTokens: '5',
            },
          },
        },
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');
  const streamResult = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  const reader = streamResult.stream.getReader();
  const parts: Array<{
    type?: string;
    usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
  }> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value as {
      type?: string;
      usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
    });
  }

  assert.ok(parts.some((part) => part.type === 'finish' && part.usage?.inputTokens?.total === 8 && part.usage?.outputTokens?.total === 5));
});

test('createNimiAiProvider text streaming returns empty usage totals when the stream never reports usage', async () => {
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      yield {
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: 1,
          },
        },
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');
  const streamResult = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'hello',
      }],
    }],
    providerOptions: {},
  });

  const reader = streamResult.stream.getReader();
  const parts: Array<{
    type?: string;
    usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
  }> = [];
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value as {
      type?: string;
      usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
    });
  }

  assert.ok(parts.some((part) => part.type === 'finish'
    && part.usage?.inputTokens?.total === undefined
    && part.usage?.outputTokens?.total === undefined));
});

test('createNimiAiProvider stream interruption requires explicit resubscribe', async () => {
  let streamGenerateCalls = 0;
  const runtime = createRuntimeStub({
    streamGenerate: async function* () {
      streamGenerateCalls += 1;
      if (streamGenerateCalls === 1) {
        yield {
          payload: {
            oneofKind: 'failed',
            failed: {
              reasonCode: ReasonCode.AI_STREAM_BROKEN,
              actionHint: 'retry',
            },
          },
        };
        return;
      }

      yield {
        payload: {
          oneofKind: 'delta',
          delta: textDelta('retry-ok'),
        },
      };
      yield {
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: 1,
          },
        },
      };
    },
  });

  const model = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  })('chat/default');

  const first = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'first-attempt',
      }],
    }],
    providerOptions: {},
  });
  const firstReader = first.stream.getReader();
  const firstParts: Array<{
    type?: string;
    delta?: string;
    error?: { reasonCode?: string };
    finishReason?: { unified?: string };
  }> = [];
  while (true) {
    const next = await firstReader.read();
    if (next.done) {
      break;
    }
    firstParts.push(next.value as {
      type?: string;
      delta?: string;
      error?: { reasonCode?: string };
      finishReason?: { unified?: string };
    });
  }

  assert.ok(firstParts.some((part) => part.type === 'error'));
  assert.ok(!firstParts.some((part) => part.type === 'finish'));

  const second = await model.doStream({
    prompt: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'second-attempt',
      }],
    }],
    providerOptions: {},
  });
  const secondReader = second.stream.getReader();
  const secondParts: Array<{
    type?: string;
    delta?: string;
    error?: { reasonCode?: string };
    finishReason?: { unified?: string };
  }> = [];
  while (true) {
    const next = await secondReader.read();
    if (next.done) {
      break;
    }
    secondParts.push(next.value as {
      type?: string;
      delta?: string;
      error?: { reasonCode?: string };
      finishReason?: { unified?: string };
    });
  }

  assert.equal(streamGenerateCalls, 2);
  assert.ok(secondParts.some((part) => part.type === 'text-delta' && part.delta === 'retry-ok'));
  assert.ok(secondParts.some((part) => part.type === 'finish' && part.finishReason?.unified === 'stop'));
});
