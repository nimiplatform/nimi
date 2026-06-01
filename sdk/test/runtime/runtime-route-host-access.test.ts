import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
  createHostRuntimeRouteAccessSurface,
  ModelHealthStatus,
  RUNTIME_TEXT_GENERATE_TIMEOUT_MS,
  type CheckModelHealthRequest,
  type CheckModelHealthResponse,
} from '../../src/runtime/index.js';

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

function createRuntimeDouble(overrides: Record<string, unknown> = {}) {
  const runtime = {
    appId: 'tester.runtime',
    ai: {},
    media: {},
    model: {
      checkHealth: mock.fn(async (request: CheckModelHealthRequest) => healthResponse({
        endpoint: request.endpoint,
        modelId: request.modelId,
      })),
    },
    connector: {
      testConnector: mock.fn(async () => ({ ack: { ok: true, reasonCode: 0, actionHint: '' } })),
    },
    local: {
      listLocalAssets: mock.fn(async () => ({
        assets: [{
          localAssetId: 'local-llama',
          assetId: 'llama/llama3',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          updatedAt: '2026-06-01T00:00:00.000Z',
          status: 1,
        }],
        nextPageToken: '',
      })),
      warmLocalAsset: mock.fn(async () => ({})),
    },
    ...overrides,
  };
  return runtime as ReturnType<typeof createHostRuntimeRouteAccessSurface> extends { getRuntimeClient(): infer T }
    ? T
    : never;
}

test('host runtime route access builds managed metadata and desktop-style call options without app facade logic', async () => {
  const surface = createHostRuntimeRouteAccessSurface({
    getRuntime: () => createRuntimeDouble(),
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
  });

  const metadata = await surface.buildRequestMetadata({
    source: 'cloud',
    connectorId: 'connector-test',
    providerEndpoint: 'https://example.invalid/v1',
  });
  assert.equal(metadata.keySource, 'managed');
  assert.equal(metadata['x-nimi-trace-id'], metadata.traceId);

  const callOptions = await surface.buildCallOptions({
    targetId: 'tester.route',
    timeoutMs: 10_000,
    source: 'cloud',
    connectorId: 'connector-test',
  });
  assert.equal(callOptions.metadata.callerKind, 'third-party-app');
  assert.equal(callOptions.metadata.callerId, 'target:tester.route');
  assert.equal(callOptions.metadata.surfaceId, 'tester.settings');
  assert.equal(callOptions.metadata.keySource, 'managed');
  assert.equal(callOptions.timeoutMs, 10_000);

  const streamOptions = await surface.buildStreamOptions({
    targetId: 'tester.route',
    timeoutMs: 10_000,
    signal: new AbortController().signal,
    source: 'cloud',
    connectorId: 'connector-test',
  });
  assert.equal(streamOptions.metadata.surfaceId, 'tester.settings');
  assert.ok(streamOptions.signal);
});

test('host runtime route access delegates provider health and local warm through Runtime clients', async () => {
  const runtime = createRuntimeDouble();
  const metrics: string[] = [];
  const surface = createHostRuntimeRouteAccessSurface({
    getRuntime: () => runtime,
    callerKind: 'desktop-core',
    surfaceId: 'desktop.renderer',
    emitWarmMetric: (metric) => metrics.push(metric.name),
  });

  const health = await surface.checkLocalHealth({
    provider: 'llama',
    localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    localProviderModel: 'llama3',
    goRuntimeLocalModelId: 'local-llama',
  });
  assert.equal(health.status, 'healthy');
  assert.equal(runtime.model.checkHealth.mock.callCount(), 1);

  const states: string[] = [];
  await surface.ensureLocalModelWarm({
    targetId: 'core.chat-ai',
    resolvedBinding: {
      source: 'local',
      model: 'llama3',
      modelId: 'llama3',
      provider: 'llama',
      localModelId: 'local-llama',
      goRuntimeLocalModelId: 'local-llama',
      engine: 'llama',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    timeoutMs: RUNTIME_TEXT_GENERATE_TIMEOUT_MS,
    onStateChange: (state) => states.push(state),
  });

  assert.equal(runtime.local.listLocalAssets.mock.callCount(), 2);
  assert.equal(runtime.local.warmLocalAsset.mock.callCount(), 1);
  assert.deepEqual(states, ['warming', 'ready']);
  assert.ok(metrics.includes('runtime_route_local_warm_attempt_total'));
});
