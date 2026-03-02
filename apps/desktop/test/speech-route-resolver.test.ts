import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechRouteResolver } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';

function createMockFields(overrides: Partial<{
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
}> = {}) {
  return {
    provider: 'openai',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    localProviderModel: 'tts-1',
    localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
    connectorId: 'conn-abc',
    ...overrides,
  };
}

test('createSpeechRouteResolver reads source/model/connectorId from RuntimeFields', async () => {
  const fields = createMockFields({
    provider: 'localai',
    localProviderModel: 'tts-1',
    connectorId: 'conn-123',
  });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'local-runtime');
  assert.equal(result.model, 'tts-1');
  assert.equal(result.connectorId, 'conn-123');
  assert.equal(result.adapter, 'openai_compat_adapter');
});

test('createSpeechRouteResolver routeSource override takes priority over inferred source', async () => {
  const fields = createMockFields({ provider: 'localai' });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod', routeSource: 'token-api' });

  assert.equal(result.source, 'token-api');
});

test('createSpeechRouteResolver connectorId override takes priority over fields.connectorId', async () => {
  const fields = createMockFields({ connectorId: 'field-conn' });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod', connectorId: 'override-conn' });

  assert.equal(result.connectorId, 'override-conn');
});

test('createSpeechRouteResolver model override takes priority over fields.localProviderModel', async () => {
  const fields = createMockFields({ localProviderModel: 'default-model' });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod', model: 'custom-model' });

  assert.equal(result.model, 'custom-model');
});

test('createSpeechRouteResolver infers local-runtime source for localai provider', async () => {
  const fields = createMockFields({ provider: 'localai' });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'local-runtime');
  assert.equal(result.engine, 'localai');
});

test('createSpeechRouteResolver infers token-api source for cloud provider', async () => {
  const fields = createMockFields({ provider: 'openai' });
  const resolve = createSpeechRouteResolver(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'token-api');
  assert.equal(result.engine, undefined);
});
