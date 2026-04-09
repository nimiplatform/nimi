import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { checkLocalLlmHealth } from '../src/runtime/llm-adapter/execution/health-check';

test('local llama health uses runtime authoritative active model state', async () => {
  const mockFetch = mock.fn(async () => new Response('{}', { status: 200 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    localProviderModel: 'llama3',
    listRuntimeLocalModelsSnapshot: async () => ([{
      localAssetId: 'local-1',
      assetId: 'llama3',
      engine: 'llama',
      status: 'active',
      endpoint: 'http://127.0.0.1:8080/v1',
    }]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:8080/v1');
  assert.equal(result.model, 'llama3');
  assert.equal(result.provider, 'llama');
  assert.equal(result.detail, '');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('local llama health returns unreachable when runtime authoritative model is unhealthy', async () => {
  const mockFetch = mock.fn(async () => new Response('Service Unavailable', { status: 503 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    localProviderModel: 'llama3',
    listRuntimeLocalModelsSnapshot: async () => ([{
      localAssetId: 'local-1',
      assetId: 'llama3',
      engine: 'llama',
      status: 'unhealthy',
      endpoint: 'http://127.0.0.1:8080/v1',
      healthDetail: 'managed local model invoke failed',
    }]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'unreachable');
  assert.equal(result.detail, 'managed local model invoke failed');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('local llama health returns unreachable when runtime authoritative model is missing', async () => {
  const mockFetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); });
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    localProviderModel: 'llama3',
    listRuntimeLocalModelsSnapshot: async () => ([]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'unreachable');
  assert.equal(result.detail, 'runtime local model unavailable');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('localOpenAiEndpoint still populates endpoint for runtime authoritative llama health', async () => {
  const mockFetch = mock.fn(async () => new Response('{}', { status: 200 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: '',
    localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'llama3',
    listRuntimeLocalModelsSnapshot: async () => ([{
      localAssetId: 'local-1',
      assetId: 'llama3',
      engine: 'llama',
      status: 'installed',
      endpoint: 'http://127.0.0.1:1234/v1',
    }]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:1234/v1');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('media health uses /healthz + /v1/catalog', async () => {
  const mockFetch = mock.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      return new Response(JSON.stringify({ ready: true }), { status: 200 });
    }
    if (url.endsWith('/v1/catalog')) {
      return new Response(JSON.stringify({ models: [{ id: 'flux.1-schnell', ready: true }] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await checkLocalLlmHealth({
    provider: 'media',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(mockFetch.mock.callCount(), 2);
  assert.ok(String(mockFetch.mock.calls[0]!.arguments[0]).endsWith('/healthz'));
  assert.ok(String(mockFetch.mock.calls[1]!.arguments[0]).endsWith('/v1/catalog'));
});

test('media health prefers runtime authoritative active model state over endpoint probe when go-runtime state is present', async () => {
  const mockFetch = mock.fn(async () => new Response('not used', { status: 500 }));
  const result = await checkLocalLlmHealth({
    provider: 'media',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
    localProviderModel: 'media/z_image_turbo',
    goRuntimeLocalModelId: 'go-z-image',
    goRuntimeStatus: 'active',
    listRuntimeLocalModelsSnapshot: async () => ([{
      localAssetId: 'go-z-image',
      assetId: 'local-import/z_image_turbo-Q4_K',
      engine: 'media',
      status: 'active',
      endpoint: 'http://127.0.0.1:8321/v1',
    }]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(result.model, 'media/z_image_turbo');
  assert.equal(result.provider, 'media');
  assert.equal(result.detail, '');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('media health returns unreachable from runtime authoritative model state when local asset is unhealthy', async () => {
  const mockFetch = mock.fn(async () => new Response('not used', { status: 500 }));
  const result = await checkLocalLlmHealth({
    provider: 'media',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
    localProviderModel: 'media/z_image_turbo',
    goRuntimeStatus: 'active',
    localModelId: 'go-z-image',
    listRuntimeLocalModelsSnapshot: async () => ([{
      localAssetId: 'go-z-image',
      assetId: 'local-import/z_image_turbo-Q4_K',
      engine: 'media',
      status: 'unhealthy',
      endpoint: 'http://127.0.0.1:8321/v1',
      healthDetail: 'managed local image backend validation failed',
    }]),
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'unreachable');
  assert.equal(result.detail, 'managed local image backend validation failed');
  assert.equal(mockFetch.mock.callCount(), 0);
});

test('speech health uses /healthz + /v1/catalog', async () => {
  const mockFetch = mock.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      return new Response(JSON.stringify({ ready: true }), { status: 200 });
    }
    if (url.endsWith('/v1/catalog')) {
      return new Response(JSON.stringify({ models: [{ id: 'qwen3-tts', ready: true }] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  const result = await checkLocalLlmHealth({
    provider: 'speech',
    localProviderEndpoint: 'http://127.0.0.1:8330/v1',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(mockFetch.mock.callCount(), 2);
  assert.ok(String(mockFetch.mock.calls[0]!.arguments[0]).endsWith('/healthz'));
  assert.ok(String(mockFetch.mock.calls[1]!.arguments[0]).endsWith('/v1/catalog'));
});

test('no endpoint no connectorId → unsupported', async () => {
  const result = await checkLocalLlmHealth({
    provider: 'openai',
  });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.endpoint, null);
  assert.ok(result.detail.includes('no endpoint or connector'));
});

test('provider remains empty when caller omitted it', async () => {
  const result = await checkLocalLlmHealth({
    provider: '',
  });

  assert.equal(result.provider, '');
});
