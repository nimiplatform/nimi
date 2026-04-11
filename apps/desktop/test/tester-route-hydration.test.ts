import assert from 'node:assert/strict';
import test from 'node:test';

import { hydrateLocalRuntimeBinding } from '../src/shell/renderer/features/tester/tester-route.js';
import type { RuntimeRouteOptionsSnapshot } from '@nimiplatform/sdk/mod';

test('tester local binding hydration rewrites stale ULID model fields to the authoritative assetId', () => {
  const snapshot: RuntimeRouteOptionsSnapshot = {
    capability: 'image.generate',
    selected: null,
    resolvedDefault: undefined,
    local: {
      models: [{
        localModelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
        model: 'local-import/z_image_turbo-Q4_K',
        modelId: 'local-import/z_image_turbo-Q4_K',
        provider: 'media',
        engine: 'media',
        endpoint: 'http://127.0.0.1:8321/v1',
        goRuntimeLocalModelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
        goRuntimeStatus: 'installed',
        capabilities: ['image.generate'],
      }],
      defaultEndpoint: 'http://127.0.0.1:8321/v1',
    },
    connectors: [],
  };

  const hydrated = hydrateLocalRuntimeBinding(snapshot, {
    source: 'local',
    connectorId: '',
    model: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    modelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    localModelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    provider: 'media',
    engine: 'media',
    endpoint: 'http://127.0.0.1:8321/v1',
    goRuntimeLocalModelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    goRuntimeStatus: 'installed',
  });

  assert.ok(hydrated);
  assert.equal(hydrated?.model, 'local-import/z_image_turbo-Q4_K');
  assert.equal(hydrated?.modelId, 'local-import/z_image_turbo-Q4_K');
  assert.equal(hydrated?.localModelId, '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ');
  assert.equal(hydrated?.goRuntimeStatus, 'installed');
});
