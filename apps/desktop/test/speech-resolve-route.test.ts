import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSpeechRoute } from '../src/runtime/hook/services/speech/resolve-route';
import type { SpeechServiceInput } from '../src/runtime/hook/services/speech/types';
import type { RouteResolverResult } from '../src/runtime/hook/services/speech/types';

function createMockContext(resolvedRoute: Partial<RouteResolverResult>): SpeechServiceInput {
  const fullRoute: RouteResolverResult = {
    source: 'local-runtime',
    provider: '',
    adapter: 'openai_compat_adapter',
    engine: '',
    localProviderEndpoint: '',
    localOpenAiEndpoint: '',
    connectorId: '',
    model: 'tts-1',
    ...resolvedRoute,
  };
  return {
    speechEngine: {} as SpeechServiceInput['speechEngine'],
    audit: { append: () => {} } as unknown as SpeechServiceInput['audit'],
    evaluatePermission: (() => ({ reasonCodes: [] })) as unknown as SpeechServiceInput['evaluatePermission'],
    resolveRoute: async () => fullRoute,
    ensureEventTopic: () => {},
  };
}

test('resolveSpeechRoute returns local-runtime route with correct fields', async () => {
  const context = createMockContext({
    source: 'local-runtime',
    provider: 'localai',
    engine: 'piper',
    adapter: 'openai_compat_adapter',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    model: 'tts-1',
  });

  const route = await resolveSpeechRoute(context, {
    modId: 'test-mod',
    routeSource: 'local-runtime',
  });

  assert.equal(route.source, 'local-runtime');
  assert.equal(route.providerType, 'OPENAI_COMPATIBLE');
  assert.equal(route.endpoint, 'http://127.0.0.1:8080/v1');
  assert.equal(route.model, 'tts-1');
  assert.equal(route.adapter, 'openai_compat_adapter');
});

test('resolveSpeechRoute returns token-api route with inferred provider type', async () => {
  const context = createMockContext({
    source: 'token-api',
    provider: 'openai:tts',
    adapter: 'openai_compat_adapter',
    localOpenAiEndpoint: 'https://api.openai.com/v1',
    model: 'tts-1-hd',
  });

  const route = await resolveSpeechRoute(context, {
    modId: 'test-mod',
    routeSource: 'token-api',
  });

  assert.equal(route.source, 'token-api');
  assert.equal(route.provider, 'openai:tts');
  assert.equal(route.model, 'tts-1-hd');
  assert.equal(route.endpoint, 'https://api.openai.com/v1');
});

test('resolveSpeechRoute throws for unsupported source', async () => {
  const context = createMockContext({
    source: 'unknown' as 'local-runtime',
  });

  await assert.rejects(
    () => resolveSpeechRoute(context, { modId: 'test-mod' }),
    (error: Error) => {
      assert.ok(error.message.includes('unsupported speech route source'));
      return true;
    },
  );
});

test('resolveSpeechRoute throws for empty source', async () => {
  const context = createMockContext({
    source: '' as 'local-runtime',
  });

  await assert.rejects(
    () => resolveSpeechRoute(context, { modId: 'test-mod' }),
    (error: Error) => {
      assert.ok(error.message.includes('unsupported speech route source'));
      return true;
    },
  );
});

test('resolveSpeechRoute uses fallback endpoint for local-runtime', async () => {
  const context = createMockContext({
    source: 'local-runtime',
    localProviderEndpoint: '',
    localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
    model: 'tts-1',
  });

  const route = await resolveSpeechRoute(context, { modId: 'test-mod' });
  assert.equal(route.endpoint, 'http://127.0.0.1:1234/v1');
});

test('resolveSpeechRoute defaults provider for token-api when provider is empty', async () => {
  const context = createMockContext({
    source: 'token-api',
    provider: '',
    model: 'tts-1',
  });

  const route = await resolveSpeechRoute(context, { modId: 'test-mod' });
  assert.equal(route.provider, 'openai-compatible:tts-1');
});

test('resolveSpeechRoute passes model to resolveRoute', async () => {
  let capturedModel = '';
  const context: SpeechServiceInput = {
    speechEngine: {} as SpeechServiceInput['speechEngine'],
    audit: { append: () => {} } as unknown as SpeechServiceInput['audit'],
    evaluatePermission: (() => ({ reasonCodes: [] })) as unknown as SpeechServiceInput['evaluatePermission'],
    resolveRoute: async (input) => {
      capturedModel = input.model || '';
      return {
        source: 'local-runtime' as const,
        provider: 'localai',
        adapter: 'openai_compat_adapter',
        engine: '',
        localProviderEndpoint: 'http://127.0.0.1:8080/v1',
        localOpenAiEndpoint: '',
        connectorId: '',
        model: input.model || 'default',
      };
    },
    ensureEventTopic: () => {},
  };

  await resolveSpeechRoute(context, { modId: 'test-mod', model: 'custom-model' });
  assert.equal(capturedModel, 'custom-model');
});
