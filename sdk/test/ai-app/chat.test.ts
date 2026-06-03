import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_APP_AI_CHAT_METADATA,
  streamAppAiChatResponse,
  submitAppAiChat,
  withDefaultAppAiChatMetadata,
} from '../../src/ai-app/index.js';
import type {
  Runtime,
  TextGenerateOutput,
  TextStreamPart,
} from '../../src/runtime/index.js';

function generateRuntime(output?: Partial<TextGenerateOutput>): Runtime {
  return {
    ai: {
      text: {
        async generate(input) {
          assert.equal(input.metadata?.callerKind, 'third-party-app');
          return {
            text: output?.text || 'Generated reply',
            finishReason: output?.finishReason || 'stop',
            usage: output?.usage || { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            trace: output?.trace || {
              traceId: 'trace-1',
              modelResolved: 'openai/gpt-4.1',
              routeDecision: 'cloud',
            },
          };
        },
      },
    },
  } as unknown as Runtime;
}

async function* streamParts(parts: readonly TextStreamPart[]): AsyncIterable<TextStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

function streamRuntime(parts: readonly TextStreamPart[]): Runtime {
  return {
    ai: {
      text: {
        async stream(input) {
          assert.equal(input.metadata?.surfaceId, 'sdk.ai-app.chat');
          return {
            stream: streamParts(parts),
          };
        },
      },
    },
  } as unknown as Runtime;
}

test('app AI chat metadata defaults are SDK-owned and request metadata wins', () => {
  const request = withDefaultAppAiChatMetadata({
    model: 'runtime-selected-chat',
    input: 'Hello',
    metadata: {
      callerId: 'app.product.chat',
      traceId: 'trace-from-app',
    },
  });

  assert.deepEqual(request.metadata, {
    ...DEFAULT_APP_AI_CHAT_METADATA,
    callerId: 'app.product.chat',
    traceId: 'trace-from-app',
  });
});

test('app AI chat metadata accepts caller-specific defaults without SDK knowing Kit', () => {
  const request = withDefaultAppAiChatMetadata({
    model: 'runtime-selected-chat',
    input: 'Hello',
    metadata: {
      traceId: 'trace-from-app',
    },
  }, {
    callerKind: 'third-party-app',
    callerId: 'custom-app.chat',
    surfaceId: 'custom.surface',
  });

  assert.deepEqual(request.metadata, {
    callerKind: 'third-party-app',
    callerId: 'custom-app.chat',
    surfaceId: 'custom.surface',
    traceId: 'trace-from-app',
  });
});

test('app AI chat metadata keeps SDK defaults when caller defaults are partial', () => {
  const request = withDefaultAppAiChatMetadata({
    model: 'runtime-selected-chat',
    input: 'Hello',
  }, {
    surfaceId: 'custom.surface',
  });

  assert.deepEqual(request.metadata, {
    callerKind: 'third-party-app',
    callerId: 'nimi-sdk.ai-app.chat',
    surfaceId: 'custom.surface',
  });
});

test('submitAppAiChat delegates to Runtime text generate with metadata defaults', async () => {
  const result = await submitAppAiChat(generateRuntime(), {
    model: 'runtime-selected-chat',
    input: 'Hello runtime',
    route: 'cloud',
  });

  assert.equal(result.text, 'Generated reply');
});

test('streamAppAiChatResponse delegates to Runtime text stream and preserves finish evidence', async () => {
  const result = await streamAppAiChatResponse(streamRuntime([
    { type: 'start' },
    { type: 'delta', text: 'First ' },
    { type: 'delta', text: 'reply' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 4 },
      trace: { traceId: 'trace-3' },
    },
  ]), {
    model: 'runtime-selected-chat',
    input: [
      { role: 'user', content: 'Prompt me' },
    ],
    route: 'cloud',
  });

  assert.equal(result.text, 'First reply');
  assert.equal(result.finish?.type, 'finish');
  assert.equal(result.finish?.trace?.traceId, 'trace-3');
});
