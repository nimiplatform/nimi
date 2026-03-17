import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { checkLocalLlmHealth } from '../src/runtime/llm-adapter/execution/health-check';

test('local endpoint GET /models ok → status healthy', async () => {
  const mockFetch = mock.fn(async () => new Response('{}', { status: 200 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    localProviderModel: 'llama3',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:8080/v1');
  assert.equal(result.model, 'llama3');
  assert.equal(result.provider, 'llama');
  assert.equal(result.detail, '');
  assert.equal(mockFetch.mock.callCount(), 1);
  const callArgs = mockFetch.mock.calls[0]!.arguments;
  assert.ok(String(callArgs[0]).endsWith('/v1/models'));
});

test('local endpoint GET /models HTTP 503 → status degraded', async () => {
  const mockFetch = mock.fn(async () => new Response('Service Unavailable', { status: 503 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.detail, 'HTTP 503');
});

test('local endpoint fetch throws → status unreachable', async () => {
  const mockFetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); });
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:8080/v1',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'unreachable');
  assert.ok(result.detail.includes('ECONNREFUSED'));
});

test('localOpenAiEndpoint used as fallback when localProviderEndpoint empty', async () => {
  const mockFetch = mock.fn(async () => new Response('{}', { status: 200 }));
  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: '',
    localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
    fetchImpl: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:1234/v1');
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
