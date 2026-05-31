import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
  ModelHealthStatus,
  type CheckModelHealthRequest,
  type CheckModelHealthResponse,
} from '../../src/runtime/index.js';
import {
  checkRuntimeRouteProviderHealth,
} from '../../src/runtime/runtime-route-provider-health.js';

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

test('runtime route provider health delegates endpoint/model readiness to Runtime model health', async () => {
  const requests: CheckModelHealthRequest[] = [];
  const checkModelHealth = mock.fn(async (request: CheckModelHealthRequest) => {
    requests.push(request);
    return healthResponse({
      endpoint: 'http://127.0.0.1:8321/v1',
      modelId: 'media/z_image_turbo',
    });
  });

  const result = await checkRuntimeRouteProviderHealth({
    appId: 'tester.app',
    provider: 'media',
    capability: 'image.generate',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
    localProviderModel: 'media/z_image_turbo',
    goRuntimeLocalModelId: 'local-z-image',
    checkModelHealth,
    nowIso: () => '2026-05-31T00:00:00Z',
  });

  assert.equal(checkModelHealth.mock.callCount(), 1);
  assert.deepEqual(requests[0], {
    appId: 'tester.app',
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
  assert.equal(result.checkedAt, '2026-05-31T00:00:00Z');
});

test('runtime route provider health maps connector checks through public Runtime connector surface', async () => {
  const testConnector = mock.fn(async () => ({
    ack: {
      ok: false,
      reasonCode: 0,
      actionHint: 'credential missing',
    },
  }));

  const result = await checkRuntimeRouteProviderHealth({
    appId: 'tester.app',
    provider: 'tester',
    connectorId: 'tester-cloud',
    localProviderModel: 'tester-model',
    checkModelHealth: async () => healthResponse(),
    testConnector,
    nowIso: () => '2026-05-31T00:00:00Z',
  });

  assert.equal(testConnector.mock.callCount(), 1);
  assert.deepEqual(testConnector.mock.calls[0]?.arguments[0], { connectorId: 'tester-cloud' });
  assert.equal(result.status, 'degraded');
  assert.equal(result.detail, 'credential missing');
});

test('runtime route provider health fails closed when no route evidence exists', async () => {
  const checkModelHealth = mock.fn(async () => healthResponse());

  const result = await checkRuntimeRouteProviderHealth({
    appId: 'tester.app',
    provider: '',
    checkModelHealth,
    nowIso: () => '2026-05-31T00:00:00Z',
  });

  assert.equal(checkModelHealth.mock.callCount(), 0);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.endpoint, null);
  assert.match(String(result.detail), /no endpoint or connector/);
});
