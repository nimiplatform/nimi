import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import { runtimeListSpeechVoices } from '../../src/runtime/runtime-modality.js';

function createMockCtx(overrides?: Partial<RuntimeInternalContext>): RuntimeInternalContext {
  return {
    appId: 'test-app',
    options: { appId: 'test-app', transport: { type: 'node-grpc', endpoint: '127.0.0.1:1' } },
    invoke: async (op) => op(),
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async () => ({
          voices: [],
          modelResolved: 'cloud/step-tts-2',
          traceId: 'trace',
        }),
      },
    } as never),
    resolveRuntimeCallOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveRuntimeStreamOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      signal: input.signal,
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveSubjectUserId: async (explicit) => explicit || 'test-subject',
    resolveOptionalSubjectUserId: async (explicit) => explicit || undefined,
    emitTelemetry: () => {},
    ...overrides,
  } as RuntimeInternalContext;
}

test('runtimeListSpeechVoices prefixes raw cloud model ids before request', async () => {
  let capturedRequest: { modelId?: string } | undefined;
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (request: unknown) => {
          capturedRequest = request as { modelId?: string };
          return {
            voices: [],
            modelResolved: 'cloud/step-tts-2',
            traceId: 'trace',
          };
        },
      },
    } as never),
  });

  await runtimeListSpeechVoices(ctx, {
    model: 'step-tts-2',
    route: 'cloud',
  });

  assert.equal(capturedRequest?.modelId, 'cloud/step-tts-2');
});
