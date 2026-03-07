import assert from 'node:assert/strict';
import test from 'node:test';

import { createResolveRuntimeBinding } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod/runtime-route';

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

test('createResolveRuntimeBinding reads source/model/connectorId from RuntimeFields', async () => {
  const fields = createMockFields({
    provider: 'openai',
    localProviderModel: 'tts-1',
    connectorId: 'conn-123',
  });
  const resolve = createResolveRuntimeBinding(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'token-api');
  assert.equal(result.model, 'tts-1');
  assert.equal(result.connectorId, 'conn-123');
  assert.equal(result.adapter, undefined);
});

test('createResolveRuntimeBinding binding source takes priority over inferred source', async () => {
  const fields = createMockFields({ provider: 'localai' });
  const resolve = createResolveRuntimeBinding(() => fields);
  const result = await resolve({
    modId: 'test-mod',
    binding: {
      source: 'token-api',
      connectorId: '',
      model: '',
    },
  });

  assert.equal(result.source, 'token-api');
});

test('createResolveRuntimeBinding connector binding takes priority over fields.connectorId', async () => {
  const fields = createMockFields({ connectorId: 'field-conn' });
  const resolve = createResolveRuntimeBinding(() => fields);
  const binding: RuntimeRouteBinding = {
    source: 'token-api',
    connectorId: 'override-conn',
    model: '',
  };
  const result = await resolve({ modId: 'test-mod', binding });

  assert.equal(result.connectorId, 'override-conn');
});

test('createResolveRuntimeBinding model binding takes priority over fields.localProviderModel', async () => {
  const fields = createMockFields({ localProviderModel: 'default-model' });
  const resolve = createResolveRuntimeBinding(() => fields);
  const binding: RuntimeRouteBinding = {
    source: 'token-api',
    connectorId: 'override-conn',
    model: 'custom-model',
    provider: 'dashscope',
  };
  const result = await resolve({ modId: 'test-mod', binding });

  assert.equal(result.model, 'custom-model');
  assert.equal(result.provider, 'dashscope');
});

test('createResolveRuntimeBinding infers local-runtime source for localai provider', async () => {
  const fields = createMockFields({ provider: 'localai' });
  const resolve = createResolveRuntimeBinding(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'local-runtime');
  assert.equal(result.engine, 'localai');
});

test('createResolveRuntimeBinding infers token-api source for cloud provider', async () => {
  const fields = createMockFields({ provider: 'openai' });
  const resolve = createResolveRuntimeBinding(() => fields);
  const result = await resolve({ modId: 'test-mod' });

  assert.equal(result.source, 'token-api');
  assert.equal(result.engine, undefined);
});
