import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
  ModelHealthStatus,
  type CheckModelHealthRequest,
  type CheckModelHealthResponse,
} from '@nimiplatform/sdk/runtime';

import { checkLocalLlmHealth } from '../src/runtime/llm-adapter/execution/health-check';

function healthResponse(overrides: Partial<CheckModelHealthResponse> = {}): CheckModelHealthResponse {
  return {
    healthy: true,
    reasonCode: 0,
    actionHint: '',
    status: ModelHealthStatus.HEALTHY,
    detail: '',
    endpoint: '',
    modelId: '',
    ...overrides,
  };
}

test('local health delegates endpoint/model readiness to Runtime model health', async () => {
  const requests: CheckModelHealthRequest[] = [];
  const runtimeModelHealth = mock.fn(async (request: CheckModelHealthRequest) => {
    requests.push(request);
    return healthResponse({
      endpoint: 'http://127.0.0.1:8321/v1',
      modelId: 'media/z_image_turbo',
    });
  });

  const result = await checkLocalLlmHealth({
    provider: 'media',
    capability: 'image.generate',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
    localProviderModel: 'media/z_image_turbo',
    goRuntimeLocalModelId: 'local-z-image',
    runtimeModelHealth,
  });

  assert.equal(runtimeModelHealth.mock.callCount(), 1);
  assert.deepEqual(requests[0], {
    appId: 'nimi.desktop',
    modelId: 'media/z_image_turbo',
    localAssetId: 'local-z-image',
    capability: 'image.generate',
    provider: 'media',
    endpoint: 'http://127.0.0.1:8321/v1',
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(result.model, 'media/z_image_turbo');
  assert.equal(result.provider, 'media');
  assert.equal(result.detail, '');
});

test('local asset health can be requested without a Desktop endpoint probe', async () => {
  const requests: CheckModelHealthRequest[] = [];
  const runtimeModelHealth = mock.fn(async (request: CheckModelHealthRequest) => {
    requests.push(request);
    return healthResponse({
      status: ModelHealthStatus.DEGRADED,
      healthy: false,
      actionHint: 'warm local model',
      endpoint: 'http://127.0.0.1:1234/v1',
      modelId: 'llama3',
    });
  });

  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderModel: 'llama3',
    localModelId: 'local-llama',
    runtimeModelHealth,
  });

  assert.equal(runtimeModelHealth.mock.callCount(), 1);
  assert.equal(requests[0]!.endpoint, '');
  assert.equal(requests[0]!.localAssetId, 'local-llama');
  assert.equal(result.status, 'degraded');
  assert.equal(result.detail, 'warm local model');
  assert.equal(result.endpoint, 'http://127.0.0.1:1234/v1');
});

test('Runtime unsupported health maps to unsupported provider health with detail', async () => {
  const runtimeModelHealth = mock.fn(async () => healthResponse({
    healthy: false,
    status: ModelHealthStatus.UNSUPPORTED,
    detail: 'plane=local-supervised; local workflow health requires capability-scoped readiness',
  }));

  const result = await checkLocalLlmHealth({
    provider: 'speech',
    capability: 'voice_workflow.voice_design',
    localProviderEndpoint: 'http://127.0.0.1:8330/v1',
    localProviderModel: 'speech/qwen3-tts',
    runtimeModelHealth,
  });

  assert.equal(result.status, 'unsupported');
  assert.match(result.detail, /plane=local-supervised/);
  assert.match(result.detail, /capability-scoped readiness/);
});

test('Runtime unreachable health maps to unreachable provider health', async () => {
  const runtimeModelHealth = mock.fn(async () => healthResponse({
    healthy: false,
    status: ModelHealthStatus.UNREACHABLE,
    detail: 'catalog probe failed: connect refused',
  }));

  const result = await checkLocalLlmHealth({
    provider: 'speech',
    localProviderEndpoint: 'http://127.0.0.1:8330/v1',
    runtimeModelHealth,
  });

  assert.equal(result.status, 'unreachable');
  assert.equal(result.detail, 'catalog probe failed: connect refused');
});

test('Runtime health errors fail closed as unreachable', async () => {
  const runtimeModelHealth = mock.fn(async () => {
    throw new Error('runtime unavailable');
  });

  const result = await checkLocalLlmHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'llama3',
    runtimeModelHealth,
  });

  assert.equal(runtimeModelHealth.mock.callCount(), 1);
  assert.equal(result.status, 'unreachable');
  assert.match(result.detail, /runtime unavailable/);
});

test('no endpoint/model/connector stays unsupported without a Runtime health call', async () => {
  const runtimeModelHealth = mock.fn(async () => healthResponse());
  const result = await checkLocalLlmHealth({
    provider: 'openai',
    runtimeModelHealth,
  });

  assert.equal(runtimeModelHealth.mock.callCount(), 0);
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
