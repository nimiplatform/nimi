import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechRouteResolver } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';

function createRuntimeFields() {
  return {
    provider: 'local-runtime:localai:openai_compat_adapter:qwen2.5-7b',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'qwen2.5-7b-instruct',
    localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
  };
}

test('speech route resolver rejects route-source encoded providerId', async () => {
  const resolveRoute = createSpeechRouteResolver(createRuntimeFields);

  await assert.rejects(
    () => resolveRoute({
      modId: 'world.nimi.test',
      providerId: 'local-runtime:localai:openai_compat_adapter:qwen2.5',
    }),
    /HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE/,
  );
});

test('speech route resolver rejects token-api as providerId', async () => {
  const resolveRoute = createSpeechRouteResolver(createRuntimeFields);

  await assert.rejects(
    () => resolveRoute({
      modId: 'world.nimi.test',
      providerId: 'token-api',
    }),
    /HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE/,
  );
});

test('speech route resolver rejects providerId and routeSource mismatch', async () => {
  const resolveRoute = createSpeechRouteResolver(createRuntimeFields);

  await assert.rejects(
    () => resolveRoute({
      modId: 'world.nimi.test',
      providerId: 'localai',
      routeSource: 'token-api',
    }),
    /providerId source mismatch/,
  );
});
