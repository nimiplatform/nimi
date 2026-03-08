import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hydrateLocalRouteBindingFromOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-routing.js';
import {
  pickPreferredGoRuntimeModel,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options';

test('pickPreferredGoRuntimeModel ignores removed entries and prefers active state', () => {
  const selected = pickPreferredGoRuntimeModel([
    {
      localModelId: 'go-removed',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'removed',
    },
    {
      localModelId: 'go-active',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'active',
    },
    {
      localModelId: 'go-installed',
      modelId: 'local-import/z_image_turbo-Q4_K',
      engine: 'localai',
      status: 'installed',
    },
  ], 'local-import/z_image_turbo-Q4_K', 'localai');

  assert.deepEqual(selected, {
    localModelId: 'go-active',
    status: 'active',
  });
});

test('hydrateLocalRouteBindingFromOptions prefers fresh local model go-runtime metadata', () => {
  const hydrated = hydrateLocalRouteBindingFromOptions({
    source: 'local',
    connectorId: '',
    model: 'local-import/z_image_turbo-Q4_K',
    modelId: 'local-import/z_image_turbo-Q4_K',
    localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    provider: 'localai',
    engine: 'localai',
    goRuntimeLocalModelId: 'go-removed',
    goRuntimeStatus: 'removed',
  }, {
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
      provider: 'localai',
      engine: 'localai',
      goRuntimeLocalModelId: 'go-active',
      goRuntimeStatus: 'active',
    },
    resolvedDefault: null,
    local: {
      models: [{
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        engine: 'localai',
        provider: 'localai',
        goRuntimeLocalModelId: 'go-active',
        goRuntimeStatus: 'active',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.equal(hydrated.goRuntimeLocalModelId, 'go-active');
  assert.equal(hydrated.goRuntimeStatus, 'active');
});

test('hydrateLocalRouteBindingFromOptions clears stale removed go-runtime metadata when refreshed model has none', () => {
  const hydrated = hydrateLocalRouteBindingFromOptions({
    source: 'local',
    connectorId: '',
    model: 'local-import/z_image_turbo-Q4_K',
    modelId: 'local-import/z_image_turbo-Q4_K',
    localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
    provider: 'localai',
    engine: 'localai',
    goRuntimeLocalModelId: 'go-removed',
    goRuntimeStatus: 'removed',
  }, {
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
      provider: 'localai',
      engine: 'localai',
    },
    resolvedDefault: null,
    local: {
      models: [{
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        engine: 'localai',
        provider: 'localai',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.equal(hydrated.goRuntimeLocalModelId, undefined);
  assert.equal(hydrated.goRuntimeStatus, undefined);
});
